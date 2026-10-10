use crate::{Error, domain::*, now};
use quick_xml::{Reader, events::Event};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, time::Duration};

pub const NEWS_URL: &str = "https://archlinux.org/feeds/news/";
const MAX_BYTES: usize = 512 * 1024;

pub fn official_news_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    let Some(slug) = url
        .path()
        .strip_prefix("/news/")
        .and_then(|p| p.strip_suffix('/'))
    else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("archlinux.org")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && !slug.is_empty()
        && !matches!(slug, "." | "..")
        && slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

fn invalid() -> Error {
    Error::Invalid(
        "Official Arch news feed is incomplete or malformed. Open the news archive and try again."
            .into(),
    )
}
fn publication(value: &str) -> Result<f64, Error> {
    let time = chrono::DateTime::parse_from_rfc2822(value.trim())
        .map_err(|_| invalid())?
        .timestamp() as f64;
    if time <= 0.0 || time > now() + 300.0 {
        return Err(invalid());
    }
    Ok(time)
}

pub fn parse_news(xml: &str) -> Result<ArchNews, Error> {
    if xml.len() > MAX_BYTES {
        return Err(invalid());
    }
    let mut reader = Reader::from_str(xml);
    let mut path: Vec<Vec<u8>> = vec![];
    let mut fields: [Option<String>; 3] = [None, None, None];
    let mut items = vec![];
    let mut links = HashSet::new();
    let mut roots = 0;
    let mut channels = 0;
    let mut channel_link = String::new();
    let mut channel_link_seen = false;
    let mut published = None;
    let mut build_seen = false;
    loop {
        match reader.read_event().map_err(|_| invalid())? {
            Event::DocType(_) => return Err(invalid()),
            Event::Empty(event) => {
                let name = event.name();
                if path.len() < 2
                    || (path.len() == 2
                        && matches!(name.as_ref(), "item" | "link" | "lastBuildDate"))
                    || (path.len() == 3
                        && path[2] == b"item"
                        && field(name.as_ref().as_bytes()).is_some())
                    || (path.len() >= 4 && path[2] == b"item" && field(&path[3]).is_some())
                {
                    return Err(invalid());
                }
            }
            Event::Start(event) => {
                path.push(event.name().as_ref().as_bytes().to_vec());
                if path.len() > 16 {
                    return Err(invalid());
                }
                if path.len() == 1 {
                    roots += 1;
                    if roots != 1 || path[0] != b"rss" {
                        return Err(invalid());
                    }
                }
                if path.len() == 2 && path[1] == b"channel" {
                    channels += 1;
                    if channels != 1 {
                        return Err(invalid());
                    }
                }
                if path.len() >= 3 && path[1] == b"channel" {
                    if path.len() == 3 && path[2] == b"item" {
                        fields = [None, None, None];
                    }
                    if path.len() == 3 && path[2] == b"link" {
                        if channel_link_seen {
                            return Err(invalid());
                        }
                        channel_link_seen = true;
                    }
                    if path.len() == 3 && path[2] == b"lastBuildDate" {
                        if build_seen {
                            return Err(invalid());
                        }
                        build_seen = true;
                        published = Some(String::new());
                    }
                    if path.len() == 4
                        && path[2] == b"item"
                        && let Some(index) = field(&path[3])
                    {
                        if fields[index].is_some() {
                            return Err(invalid());
                        }
                        fields[index] = Some(String::new());
                    }
                    if path.len() > 4 && path[2] == b"item" && field(&path[3]).is_some() {
                        return Err(invalid());
                    }
                }
            }
            Event::Text(event) if path.is_empty() => {
                if !event.as_ref().trim().is_empty() {
                    return Err(invalid());
                }
            }
            Event::CData(_) | Event::GeneralRef(_) if path.is_empty() => return Err(invalid()),
            Event::Text(event) => append(
                &path,
                &mut fields,
                &mut channel_link,
                &mut published,
                event.as_ref(),
            )?,
            Event::CData(event) => append(
                &path,
                &mut fields,
                &mut channel_link,
                &mut published,
                event.as_ref(),
            )?,
            Event::GeneralRef(event) => {
                let reference = format!("&{};", event.as_ref());
                let decoded = quick_xml::escape::unescape(&reference).map_err(|_| invalid())?;
                append(
                    &path,
                    &mut fields,
                    &mut channel_link,
                    &mut published,
                    &decoded,
                )?;
            }
            Event::End(_) => {
                if path.len() == 3 && path[1] == b"channel" && path[2] == b"item" {
                    let [title, url, date] = fields
                        .clone()
                        .map(|v| v.unwrap_or_default().trim().to_owned());
                    if title.is_empty()
                        || title.chars().any(|c| c.is_control())
                        || !official_news_url(&url)
                        || !links.insert(url.clone())
                        || items.len() >= 50
                    {
                        return Err(invalid());
                    }
                    items.push(ArchNotice {
                        title,
                        url,
                        published_at: publication(&date)?,
                    });
                }
                path.pop().ok_or_else(invalid)?;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if roots != 1
        || channels != 1
        || !path.is_empty()
        || channel_link.trim() != "https://archlinux.org/news/"
        || items.is_empty()
    {
        return Err(invalid());
    }
    items.sort_by(|a, b| {
        b.published_at
            .total_cmp(&a.published_at)
            .then(a.url.cmp(&b.url))
    });
    Ok(ArchNews {
        checked_at: now(), source_url: NEWS_URL.into(), digest: format!("{:x}", Sha256::digest(xml.as_bytes())),
        published_at: published.as_deref().map(publication).transpose()?, items,
        limitations: vec!["The feed is a recent publication window, not a complete news history or an applicability check. Read the archive if you skipped earlier updates.".into(), "Capture time records retrieval, not the freshness of the publisher’s feed. Article dates do not certify update readiness.".into()],
    })
}
fn field(name: &[u8]) -> Option<usize> {
    match name {
        b"title" => Some(0),
        b"link" => Some(1),
        b"pubDate" => Some(2),
        _ => None,
    }
}
fn append(
    path: &[Vec<u8>],
    fields: &mut [Option<String>; 3],
    link: &mut String,
    published: &mut Option<String>,
    text: &str,
) -> Result<(), Error> {
    let target = if path.len() == 4 && path[1] == b"channel" && path[2] == b"item" {
        field(&path[3]).and_then(|i| fields[i].as_mut()).map(|v| {
            (
                v,
                match field(&path[3]) {
                    Some(0) => 600,
                    Some(1) => 2048,
                    _ => 128,
                },
            )
        })
    } else if path.len() == 3 && path[1] == b"channel" && path[2] == b"link" {
        Some((link, 2048))
    } else if path.len() == 3 && path[1] == b"channel" && path[2] == b"lastBuildDate" {
        published.as_mut().map(|v| (v, 128))
    } else {
        None
    };
    if let Some((value, limit)) = target {
        if value.len() + text.len() > limit {
            return Err(invalid());
        }
        value.push_str(text);
    }
    Ok(())
}

pub async fn news() -> Result<ArchNews, Error> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .user_agent("ArchHub/0.1 (official update notice reader)")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()?;
    let mut response = client.get(NEWS_URL).send().await?;
    if !response.status().is_success() {
        return Err(Error::Invalid(format!(
            "Official Arch news returned HTTP {}",
            response.status()
        )));
    }
    let mut bytes = vec![];
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(invalid());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_news(std::str::from_utf8(&bytes).map_err(|_| invalid())?)
}

pub fn capture(
    snapshot: &Snapshot,
    repositories: Result<RepositoryUpdates, Error>,
    news: Result<ArchNews, Error>,
) -> UpdatePreparation {
    let (repositories, repository_error) = match repositories {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e.to_string())),
    };
    let (news, news_error) = match news {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e.to_string())),
    };
    UpdatePreparation { captured_at: now(), fingerprint: snapshot.fingerprint.clone(), command: if snapshot.omarchy { "omarchy update" } else { "sudo pacman -Syu" }.into(), repositories, repository_error, news, news_error,
        limitations: vec!["This capture prepares a terminal handoff. It does not resolve, authorize or execute an upgrade transaction.".into(), "Repository checks use temporary databases and configured mirrors. Foreign packages, AUR recipes, toolchains and Omarchy migrations are outside their counts.".into(), "The supported updater determines the final transaction. Review its output and recovery instructions before proceeding.".into()] }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn feed(item: &str) -> String {
        format!("<rss><channel><link>https://archlinux.org/news/</link>{item}</channel></rss>")
    }
    fn item() -> &'static str {
        "<item><title>Review &amp; repair &#8212; notice</title><link>https://archlinux.org/news/test-notice/</link><pubDate>Tue, 22 Sep 2026 12:00:00 +0000</pubDate><description><![CDATA[<script>ignored</script>]]></description></item>"
    }
    fn snapshot(omarchy: bool) -> Snapshot {
        Snapshot {
            captured_at: now(),
            fingerprint: "fixture".into(),
            hostname: "fixture".into(),
            installed_count: 0,
            explicit_count: 0,
            foreign_count: 0,
            update_count: 0,
            installed_size: 0.0,
            repositories: vec![],
            warnings: vec![],
            locked: false,
            omarchy,
            signature_policy: vec![],
        }
    }
    #[test]
    fn preserves_independent_failures_and_supported_updater() {
        let report = capture(
            &snapshot(true),
            Err(Error::Invalid("missing checkupdates".into())),
            parse_news(&feed(item())),
        );
        assert!(report.repositories.is_none());
        assert_eq!(
            report.repository_error.as_deref(),
            Some("missing checkupdates")
        );
        assert!(report.news.is_some());
        assert!(report.news_error.is_none());
        assert_eq!(report.command, "omarchy update");
        let report = capture(
            &snapshot(false),
            Ok(RepositoryUpdates {
                checked_at: now(),
                fingerprint: "fixture".into(),
                packages: vec![],
                limitations: vec![],
            }),
            Err(invalid()),
        );
        assert_eq!(report.command, "sudo pacman -Syu");
        assert_eq!(report.repositories.unwrap().fingerprint, report.fingerprint);
        assert!(report.news.is_none());
        assert!(report.news_error.is_some());
    }
    #[test]
    fn captures_only_titles_dates_and_official_links() {
        let news = parse_news(&feed(&format!(
            "<atom:link href=\"https://archlinux.org/feeds/news/\"/>{}",
            item()
        )))
        .unwrap();
        assert_eq!(news.items[0].title, "Review & repair — notice");
        assert_eq!(news.digest.len(), 64);
        assert!(!serde_json::to_string(&news).unwrap().contains("script"));
        assert!(
            parse_news(&feed(&item().replace(
                "Review &amp; repair &#8212; notice",
                "<![CDATA[Review & repair]]>"
            )))
            .is_ok()
        );
    }
    #[test]
    fn rejects_unsafe_links() {
        for url in [
            "javascript:alert(1)",
            "http://archlinux.org/news/test/",
            "https://evil.test/news/test/",
            "https://archlinux.org@evil.test/news/test/",
            "https://user@archlinux.org/news/test/",
            "https://archlinux.org/news/../test/",
            "https://archlinux.org/news/test/?x=1",
            "https://archlinux.org/news/test/#x",
            "https://archlinux.org:444/news/test/",
        ] {
            assert!(!official_news_url(url), "{url}");
        }
    }
    #[test]
    fn rejects_incomplete_duplicate_and_invalid_xml() {
        for xml in [
            feed(""),
            feed(&format!("{}{}", item(), item())),
            feed(&item().replace("<title>", "<title><b>")),
            feed(&item().replace("+0000", "invalid")),
            feed(&item().replace("<title>", "<title/>")),
            format!("<!DOCTYPE rss SYSTEM 'file:///etc/passwd'>{}", feed(item())),
            "<html>unavailable</html>".into(),
            format!("{}trailing content", feed(item())),
            feed(item()).replace("</channel>", "</rss>"),
        ] {
            assert!(parse_news(&xml).is_err(), "{xml}");
        }
    }
    #[test]
    fn enforces_feed_field_and_depth_limits() {
        assert!(
            parse_news(&feed(
                &item().replace("Review &amp; repair &#8212; notice", &"a".repeat(601))
            ))
            .is_err()
        );
        assert!(parse_news(&"a".repeat(MAX_BYTES + 1)).is_err());
        let deep = format!(
            "{}<description>{}{}</description></item>",
            item().trim_end_matches("</item>"),
            "<x>".repeat(20),
            "</x>".repeat(20)
        );
        assert!(parse_news(&feed(&deep)).is_err());
        let many = (0..51)
            .map(|i| item().replace("test-notice/", &format!("test-{i}/")))
            .collect::<String>();
        assert!(parse_news(&feed(&many)).is_err());
    }
}
