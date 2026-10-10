// This verification hook is compiled only in debug builds and must be explicitly enabled.
pub fn output_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Desktop crate has a workspace parent")
        .join("artifacts/native-smoke-evidence.json")
}

pub fn script() -> String {
    if std::env::var("ARCHHUB_SMOKE_PREPARATION").is_ok_and(|value| value == "1") {
        return PREPARATION_SCRIPT.replace(
            "__ARCHHUB_SMOKE_PATH__",
            &serde_json::to_string(&output_path()).expect("Smoke path must serialize"),
        );
    }
    SCRIPT
        .replace(
            "__ARCHHUB_SMOKE_PATH__",
            &serde_json::to_string(&output_path()).expect("Smoke path must be JSON-serializable"),
        )
        .replace(
            "__ARCHHUB_RULESET_VERSION__",
            &archhub_core::scanner::RULESET_VERSION.to_string(),
        )
        .replace(
            "__ARCHHUB_SMOKE_ADVISORY__",
            if std::env::var("ARCHHUB_SMOKE_ADVISORY").is_ok_and(|value| value == "1") {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__ARCHHUB_SMOKE_RECIPE_LIFECYCLE__",
            if std::env::var("ARCHHUB_SMOKE_RECIPE_LIFECYCLE").is_ok_and(|value| value == "1") {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__ARCHHUB_SMOKE_CHANGES__",
            if std::env::var("ARCHHUB_SMOKE_CHANGES").is_ok_and(|value| value == "1") {
                "true"
            } else {
                "false"
            },
        )
}

const SCRIPT: &str = r#"
(() => {
  let attempts = 0;
  const timer = setInterval(async () => {
    if (!document.querySelector('h1')) {
      if (++attempts > 100) { clearInterval(timer); document.title = 'ArchHub smoke FAILED: UI did not render'; }
      return;
    }
    clearInterval(timer);
    try {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const snapshot = await invoke('query', {request:{command:'snapshot',refresh:false}});
      const packages = await invoke('query', {request:{command:'packages',query:'pacman',scope:'installed',repository:'all',offset:0,limit:10,sort:'name'}});
      if (!snapshot.installedCount || !packages.items.some(p => p.name === 'pacman')) throw new Error('native inventory mismatch');
      const foreignPackages = await invoke('query', {request:{command:'packages',query:'',scope:'foreign',repository:'all',offset:0,limit:10,sort:'name'}});
      const foreignPackage = foreignPackages.items[0];
      const foreignLookup = foreignPackage ? await invoke('query', {request:{command:'foreign_recipe',name:foreignPackage.name,version:foreignPackage.installedVersion,fingerprint:snapshot.fingerprint}}) : null;
      let foreignStaleRejected = false;
      if (foreignPackage) {
        if (foreignLookup.name !== foreignPackage.name || foreignLookup.installedVersion !== foreignPackage.installedVersion || foreignLookup.fingerprint !== snapshot.fingerprint) throw new Error('native foreign recipe identity mismatch');
        try { await invoke('query', {request:{command:'foreign_recipe',name:foreignPackage.name,version:'stale-1',fingerprint:snapshot.fingerprint}}); } catch { foreignStaleRejected = true; }
        if (!foreignStaleRejected) throw new Error('stale foreign recipe identity accepted');
      }
      const dependencies = await invoke('query', {request:{command:'dependencies',name:'pacman',version:packages.items.find(p => p.name === 'pacman').installedVersion}});
      if (dependencies.root.name !== 'pacman' || !dependencies.requires.some(p => p.package.name === 'openssl')) throw new Error('native dependency contract mismatch');
      let dependencyStaleRejected = false;
      try { await invoke('query', {request:{command:'dependencies',name:'pacman',version:'stale-1'}}); } catch { dependencyStaleRejected = true; }
      if (!dependencyStaleRejected) throw new Error('stale native dependency identity accepted');
      const comparison = await invoke('query', {request:{command:'comparison',name:'pacman',fingerprint:snapshot.fingerprint}});
      if (comparison.name !== 'pacman' || !comparison.changes.some(c => c.kind === 'Required dependencies') || comparison.fingerprint !== snapshot.fingerprint) throw new Error('native candidate comparison mismatch');
      let comparisonStaleRejected = false;
      try { await invoke('query', {request:{command:'comparison',name:'pacman',fingerprint:'stale'}}); } catch { comparisonStaleRejected = true; }
      if (!comparisonStaleRejected) throw new Error('stale native candidate identity accepted');
      const plan = await invoke('query', {request:{command:'plan',fingerprint:snapshot.fingerprint}});
      if (!Array.isArray(plan.comparisons) || typeof plan.comparisonsComplete !== 'boolean') throw new Error('native comparison plan contract mismatch');
      if (!plan.security || !Array.isArray(plan.security.findings) || (!plan.security.audit && !plan.security.unavailableReason)) throw new Error('native plan advisory contract mismatch');
      if (plan.security.audit && plan.security.audit.fingerprint !== plan.fingerprint) throw new Error('native plan advisory identity mismatch');
      const sourceInspection = await invoke('query', {request:{command:'recipe',base:'visual-studio-code-bin'}});
      if (sourceInspection.scan.staticAnalyzerVersion !== __ARCHHUB_RULESET_VERSION__ || !sourceInspection.scan.complete) throw new Error('native versioned static capture unavailable');
      let analyzerStaleRejected = 0;
      for (const version of [undefined, sourceInspection.scan.staticAnalyzerVersion + 1]) {
        try { await invoke('query', {request:{command:'record_recipe_review',base:sourceInspection.scan.packageBase,digest:sourceInspection.scan.digest,commit:sourceInspection.scan.commit,staticAnalyzerVersion:version,note:'Automated stale analyzer rejection probe; this must never be recorded.'}}); }
        catch { analyzerStaleRejected++; }
      }
      if (analyzerStaleRejected !== 2) throw new Error('native stale analyzer version accepted');
      if (!sourceInspection.scan.sourceEvidence?.sources.length || sourceInspection.scan.sourceEvidence.metadataDigest !== sourceInspection.scan.files.find(f => f.path === '.SRCINFO')?.digest) throw new Error('native source evidence mismatch');
      const integrity = await invoke('query', {request:{command:'integrity',name:'pacman',version:packages.items.find(p => p.name === 'pacman').installedVersion}});
      if (integrity.name !== 'pacman' || !integrity.totalEntries || !Array.isArray(integrity.issues)) throw new Error('native integrity contract mismatch');
      let staleRejected = false;
      try { await invoke('query', {request:{command:'integrity',name:'pacman',version:'stale-1'}}); } catch { staleRejected = true; }
      if (!staleRejected) throw new Error('stale native integrity identity accepted');
      const reviews = await invoke('query', {request:{command:'recipe_reviews'}});
      if (!Array.isArray(reviews)) throw new Error('native recipe review contract mismatch');
      let rejected = false;
      try { await invoke('query', {request:{command:'recipe',base:'../etc/passwd'}}); } catch { rejected = true; }
      if (!rejected) throw new Error('invalid recipe identifier accepted');
      const maintenance = await invoke('query', {request:{command:'maintenance'}});
      if (maintenance.fingerprint !== snapshot.fingerprint || !Array.isArray(maintenance.orphans) || maintenance.largest.length > 20 || !Array.isArray(maintenance.caches)) throw new Error('native maintenance contract mismatch');
      const repositoryUpdates = maintenance.checkupdatesAvailable ? await invoke('query', {request:{command:'repository_updates',fingerprint:snapshot.fingerprint}}) : null;
      const foreignUpdates = await invoke('query', {request:{command:'foreign_updates',fingerprint:snapshot.fingerprint}});
      if (repositoryUpdates && repositoryUpdates.fingerprint !== snapshot.fingerprint) throw new Error('native online repository identity mismatch');
      if (foreignUpdates.fingerprint !== snapshot.fingerprint || foreignUpdates.packages.length !== maintenance.foreign.length) throw new Error('native batch foreign identity mismatch');
      let maintenanceStaleRejected = 0;
      for (const command of ['repository_updates', 'foreign_updates']) {
        try { await invoke('query', {request:{command,fingerprint:'stale'}}); } catch { maintenanceStaleRejected++; }
      }
      if (maintenanceStaleRejected !== 2) throw new Error('native online check accepted stale inventory');
      const maintenanceChecks = {maintenance, repositoryUpdates, foreignUpdates, staleRejected:true};
      const pacmanTarget = {name:'pacman',version:packages.items.find(p => p.name === 'pacman').installedVersion};
      const removalPlan = await invoke('query', {request:{command:'removal_plan',targets:[pacmanTarget],fingerprint:snapshot.fingerprint}});
      if (removalPlan.fingerprint !== snapshot.fingerprint || removalPlan.targets[0]?.version !== pacmanTarget.version || !removalPlan.packages.length || removalPlan.command || (!removalPlan.heldPackages.length && !removalPlan.blockers.length)) throw new Error('native removal plan policy/identity mismatch');
      let removalRejected = 0;
      for (const request of [
        {command:'removal_plan',targets:[pacmanTarget],fingerprint:'stale'},
        {command:'removal_plan',targets:[{...pacmanTarget,version:'stale-1'}],fingerprint:snapshot.fingerprint},
        {command:'removal_plan',targets:[{name:'x;id',version:'1-1'}],fingerprint:snapshot.fingerprint}
      ]) { try { await invoke('query', {request}); } catch { removalRejected++; } }
      if (removalRejected !== 3) throw new Error('native invalid removal identity accepted');
      const removalTaskState = await invoke('removal_task_state');
      if (typeof removalTaskState.available !== 'boolean' || (removalTaskState.available === false && !removalTaskState.unavailableReason)) throw new Error('native removal capability contract mismatch');
      let directRemovalRejected = 0;
      for (const protocol of [999, 1]) {
        try { await invoke('start_removal_task', {request:{protocol,targets:[pacmanTarget],fingerprint:snapshot.fingerprint,executionDigest:removalPlan.executionDigest ?? 'a'.repeat(64)}}); }
        catch { directRemovalRejected++; }
      }
      if (directRemovalRejected !== 2 || (await invoke('removal_task_state')).task?.status === 'running') throw new Error('native invalid/held removal reached authentication');
      const output = __ARCHHUB_SMOKE_PATH__;
      const write = path => invoke('plugin:fs|write_text_file', new TextEncoder().encode(JSON.stringify({snapshot, packages, removalTaskState, directRemovalRejected, removalRecoveryWorkspaceRendered:document.documentElement.dataset.removalRecoveryEvidence === 'rendered', removalPlan, removalRejected, removalWorkspaceRendered:document.documentElement.dataset.removalEvidence === 'rendered', maintenanceChecks, maintenanceWorkspaceRendered:document.documentElement.dataset.maintenanceEvidence === 'rendered', foreignLookup, foreignStaleRejected, foreignLookupWorkspaceRendered:document.documentElement.dataset.foreignLookupEvidence === 'rendered', foreignRecipeWorkspaceRendered:document.documentElement.dataset.foreignRecipeEvidence === 'rendered', recipeLifecycleWorkspaceRendered:__ARCHHUB_SMOKE_RECIPE_LIFECYCLE__ ? document.documentElement.dataset.recipeLifecycleEvidence === 'rendered' : null, recipeReviewCount:reviews.length, recipeReviewWorkspaceRendered:true, integrity, integrityWorkspaceRendered:!!document.querySelector('[data-integrity-evidence]'), dependencies, dependencyStaleRejected, dependenciesWorkspaceRendered:document.documentElement.dataset.dependenciesEvidence === 'rendered', comparison, comparisonStaleRejected, plan, planSecurityWorkspaceRendered:document.documentElement.dataset.planSecurityEvidence === 'rendered', sharedAdvisoryWorkspaceRendered:__ARCHHUB_SMOKE_ADVISORY__ ? document.documentElement.dataset.sharedAdvisoryEvidence === 'rendered' : null, comparisonWorkspaceRendered:document.documentElement.dataset.comparisonEvidence === 'rendered', sourceInspection, sourcesWorkspaceRendered:document.documentElement.dataset.sourcesEvidence === 'rendered', staticFindingWorkspaceRendered:document.documentElement.dataset.staticFindingEvidence === 'rendered', sourceSearchWorkspaceRendered:document.documentElement.dataset.sourceSearchEvidence === 'rendered', analyzerStaleRejected:analyzerStaleRejected === 2, rulesetWorkspaceRendered:document.documentElement.dataset.rulesetEvidence === 'rendered', reviewRowWorkspaceRendered:__ARCHHUB_SMOKE_CHANGES__ ? document.documentElement.dataset.reviewRowEvidence === 'rendered' : null, findingChangesWorkspaceRendered:__ARCHHUB_SMOKE_CHANGES__ ? document.documentElement.dataset.findingChangesEvidence === 'rendered' : null, changedLineSourceWorkspaceRendered:__ARCHHUB_SMOKE_CHANGES__ ? document.documentElement.dataset.changedLineSourceEvidence === 'rendered' : null}, null, 2)), {headers:{path:encodeURIComponent(path),options:'{}'}});
      let denied = false;
      try { await write(output + '.not-authorized'); } catch (error) { denied = String(error).includes('forbidden path'); }
      if (!denied) throw new Error('unselected filesystem path was not denied');
      window.location.hash = '/reviews';
      await new Promise((resolve, reject) => {
        let count = 0;
        const check = setInterval(() => {
          if (document.querySelector('h1')?.textContent === 'Recipe reviews') { clearInterval(check); resolve(); }
          else if (++count > 100) { clearInterval(check); reject(new Error('native review workspace did not render')); }
        }, 100);
      });
      window.location.hash = '/integrity?q=pacman';
      await new Promise((resolve, reject) => {
        let count = 0;
        const check = setInterval(() => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Check files');
          if (button && !button.disabled) { clearInterval(check); button.click(); resolve(); }
          else if (++count > 100) { clearInterval(check); reject(new Error('native integrity action unavailable')); }
        }, 100);
      });
      await new Promise((resolve, reject) => {
        let count = 0;
        const check = setInterval(() => {
          if ([...document.querySelectorAll('h2')].some(h => h.textContent === 'File evidence · pacman')) {
            clearInterval(check); document.documentElement.dataset.integrityEvidence = 'rendered'; resolve();
          } else if (++count > 900) { clearInterval(check); reject(new Error('native integrity evidence did not render')); }
        }, 100);
      });
      window.location.hash = '/dependencies?q=pacman';
      await new Promise((resolve, reject) => {
        let count = 0;
        const check = setInterval(() => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Inspect dependencies');
          if (button && !button.disabled) { clearInterval(check); button.click(); resolve(); }
          else if (++count > 100) { clearInterval(check); reject(new Error('native dependency action unavailable')); }
        }, 100);
      });
      await new Promise((resolve, reject) => {
        let count = 0;
        const check = setInterval(() => {
          if ([...document.querySelectorAll('h2')].some(h => h.textContent === 'Installed paths · pacman')) {
            clearInterval(check); document.documentElement.dataset.dependenciesEvidence = 'rendered'; resolve();
          } else if (++count > 100) { clearInterval(check); reject(new Error('native dependency workspace did not render')); }
        }, 100);
      });
      const waitFor = (predicate, label) => new Promise((resolve, reject) => {
        let count = 0;
        const check = setInterval(() => {
          const element = predicate();
          if (element) { clearInterval(check); resolve(element); }
          else if (++count > 600) { clearInterval(check); reject(new Error(label)); }
        }, 100);
      });
      if (__ARCHHUB_SMOKE_ADVISORY__) {
        window.location.hash = '/security';
        await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export' && !b.disabled), 'native initial advisory capture unavailable');
        let release;
        let gate = new Promise(resolve => { release = resolve; });
        let controlledFailure = true;
        let forcedChecks = 0;
        const nativeFetch = window.fetch;
        window.fetch = async (url, options) => {
          const args = url === window.__TAURI_INTERNALS__.convertFileSrc('query', 'ipc') && typeof options?.body === 'string' ? JSON.parse(options.body) : null;
          if (args?.request?.command === 'audit' && args.request.refresh) {
            forcedChecks++;
            await gate;
            if (controlledFailure) return new Response(JSON.stringify('Native controlled advisory failure'), {status:400, headers:{'Content-Type':'application/json','Tauri-Response':'error'}});
          }
          return nativeFetch.call(window, url, options);
        };
        try {
          (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Run advisory check' && !b.disabled), 'native advisory check unavailable')).click();
          await waitFor(() => forcedChecks === 1 ? document.body : null, 'native explicit check did not start');
          window.location.hash = '/history';
          await waitFor(() => document.querySelector('h1')?.textContent === 'Activity' ? document.body : null, 'native inactive audit route unavailable');
          window.location.hash = '/overview';
          await waitFor(() => document.querySelector('button[aria-label="Installed-version advisories"]')?.textContent.includes('Checking the Arch feed…') ? document.body : null, 'native pending audit was lost across navigation');
          const metric = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Advisory matches'));
          if (!metric?.textContent.includes('—') || document.body.textContent.includes('Latest advisory matches')) throw new Error('native pending capture retained prior conclusions');
          release();
          await waitFor(() => document.querySelector('button[aria-label="Installed-version advisories"]')?.textContent.includes('Current advisory evidence unavailable') ? document.body : null, 'native audit failure did not propagate');
          window.location.hash = '/security';
          await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('Native controlled advisory failure') ? document.body : null, 'native string IPC failure detail missing');
          if (forcedChecks !== 1 || ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export')?.disabled) throw new Error('native failed advisory remained reusable');
          controlledFailure = false;
          gate = Promise.resolve();
          (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Try again' && !b.disabled), 'native advisory retry unavailable')).click();
          await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export' && !b.disabled), 'native live advisory retry failed');
          if (forcedChecks !== 2) throw new Error('native explicit retries were duplicated');
          const currentAudit = await invoke('query', {request:{command:'audit',refresh:false}});
          if (currentAudit.fingerprint !== snapshot.fingerprint) throw new Error('native advisory retry identity mismatch');
          document.documentElement.dataset.sharedAdvisoryEvidence = 'rendered';
        } finally {
          release();
          window.fetch = nativeFetch;
        }
      }
      window.location.hash = '/updates';
      (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create review plan' && !b.disabled), 'native plan action unavailable')).click();
      await waitFor(() => document.querySelector('[role="dialog"] section[aria-label="Plan advisory evidence"]'), 'native plan security evidence unavailable');
      document.documentElement.dataset.planSecurityEvidence = 'rendered';
      document.querySelector('[role="dialog"] [data-slot="dialog-close"]').click();
      await waitFor(() => !document.querySelector('[role="dialog"]') ? document.body : null, 'native plan dialog did not close');
      const comparisonTab = await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === 'Compare package'), 'native comparison view unavailable');
      comparisonTab.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0})); comparisonTab.click();
      (await waitFor(() => { const button = document.querySelector('section[aria-label="Package candidate comparison"] button[type="submit"]'); return button && !button.disabled ? button : null; }, 'native candidate action unavailable')).click();
      await waitFor(() => [...document.querySelectorAll('h3')].find(h => h.textContent === 'pacman · candidate review'), 'native candidate workspace did not render');
      document.documentElement.dataset.comparisonEvidence = 'rendered';
      window.location.hash = '/aur';
      const search = await waitFor(() => document.querySelector('input[aria-label="Search AUR packages"]'), 'native AUR search unavailable');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'visual-studio-code-bin');
      search.dispatchEvent(new Event('input', {bubbles:true}));
      (await waitFor(() => document.querySelector('button[aria-label="View visual-studio-code-bin"]'), 'native AUR package unavailable')).click();
      const activateTab = tab => {
        tab.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
        tab.click();
      };
      activateTab(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === 'Static scan'), 'native static scan tab unavailable'));
      (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fetch & run static scan' && !b.disabled), 'native scan action unavailable')).click();
      await waitFor(() => document.querySelector('input[aria-label="Search static findings"]'), 'native static finding search unavailable');
      await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('Rules v' + sourceInspection.scan.staticAnalyzerVersion + ' · text heuristics'), 'native static rules version unavailable');
      document.documentElement.dataset.rulesetEvidence = 'rendered';
      const staticFinding = await waitFor(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes(sourceInspection.scan.findings[0]?.title) && !button.disabled), 'native static finding action unavailable');
      staticFinding.click();
      await waitFor(() => {
        const region = document.querySelector('section[aria-label="Build recipe source"]');
        const selected = document.getElementById(region?.getAttribute('aria-describedby'))?.textContent.match(/Selected (.*):(\d+)/);
        if (!selected || document.activeElement !== region) return null;
        const code = region.querySelectorAll('code')[(Number(selected[2]) - 1) % 400];
        const viewport = region.querySelector('pre')?.parentElement;
        if (!code || !viewport) return null;
        const line = code.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        return line.top >= Math.max(bounds.top, 0) && line.bottom <= Math.min(bounds.bottom, innerHeight) ? code : null;
      }, 'native selected static source line was clipped');
      document.documentElement.dataset.staticFindingEvidence = 'rendered';
      const sourceRegion = document.querySelector('section[aria-label="Build recipe source"]');
      const sourceLocation = document.getElementById(sourceRegion.getAttribute('aria-describedby')).textContent.match(/Selected (.*):(\d+)/);
      const sourceTerm = sourceRegion.querySelectorAll('code')[(Number(sourceLocation[2]) - 1) % 400].textContent.trim().toUpperCase();
      if (!sourceTerm) throw new Error('native source search term unavailable');
      const sourceSearch = sourceRegion.querySelector('input[aria-label="Find in captured file"]');
      if (!sourceSearch) throw new Error('native source search input unavailable');
      sourceSearch.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sourceSearch, sourceTerm);
      sourceSearch.dispatchEvent(new Event('input', {bubbles:true}));
      const searchedLineVisible = () => {
        const selected = document.getElementById(sourceRegion.getAttribute('aria-describedby')).textContent.match(/Selected (.*):(\d+)/);
        const code = selected && sourceRegion.querySelectorAll('code')[(Number(selected[2]) - 1) % 400];
        const viewport = sourceRegion.querySelector('pre')?.parentElement;
        if (!code || !viewport || document.activeElement !== sourceSearch || !code.textContent.toUpperCase().includes(sourceTerm)) return null;
        const line = code.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        return line.top >= Math.max(bounds.top, 0) && line.bottom <= Math.min(bounds.bottom, innerHeight) ? code : null;
      };
      await waitFor(searchedLineVisible, 'native searched source line was clipped or focus lost');
      sourceSearch.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
      await waitFor(searchedLineVisible, 'native source match navigation failed');
      document.documentElement.dataset.sourceSearchEvidence = 'rendered';
      if (__ARCHHUB_SMOKE_CHANGES__) {
        if (sourceInspection.baseline?.commit !== 'f'.repeat(40) || !sourceInspection.baseline.note.startsWith('Isolated synthetic baseline for native changed-line verification')) throw new Error('isolated native change fixture unavailable');
        activateTab(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(tab => /^Changes \(/.test(tab.textContent.trim())), 'native change tab unavailable'));
        const findingComparison = await waitFor(() => document.querySelector('section[aria-label="Static finding changes"]'), 'native finding comparison unavailable');
        const retained = sourceInspection.scan.findings.find(finding => finding.line > 0 && finding.file);
        if (!retained) throw new Error('native finding comparison fixture has no source observation');
        if (!findingComparison.textContent.includes('Still reported (') || !findingComparison.textContent.includes('A missing observation does not establish that a risk is fixed.')) throw new Error('native finding comparison counts or limits missing');
        for (const side of ['reviewed', 'current']) {
          const action = await waitFor(() => findingComparison.querySelector('button[aria-label="Inspect ' + side + ' finding ' + retained.file + ' line ' + retained.line + '"]'), 'native finding source action unavailable');
          action.click();
          await waitFor(() => {
            const region = findingComparison.querySelector('section[aria-label="Finding source context"]');
            const code = region?.querySelectorAll('code')[(retained.line - 1) % 400];
            const expected = sourceInspection.scan.files.find(file => file.path === retained.file).content.split('\n')[retained.line - 1];
            const viewport = region?.querySelector('pre')?.parentElement;
            if (!region || document.activeElement !== region || code?.textContent !== expected || !viewport) return null;
            const line = code.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
            return line.top >= Math.max(bounds.top, 0) && line.bottom <= Math.min(bounds.bottom, innerHeight) ? code : null;
          }, 'native finding source mismatch or clipped');
          (await waitFor(() => [...findingComparison.querySelectorAll('button')].find(button => button.textContent.trim() === 'Return to findings'), 'native finding return unavailable')).click();
          await waitFor(() => document.activeElement === action ? action : null, 'native finding focus did not return');
        }
        document.documentElement.dataset.findingChangesEvidence = 'rendered';
        for (const side of ['reviewed', 'current']) {
          const action = await waitFor(() => document.querySelector('button[aria-label="Inspect ' + side + ' PKGBUILD line 1"]'), 'native diff source action unavailable');
          action.click();
          const label = side === 'reviewed' ? 'Reviewed recipe source' : 'Current recipe source';
          const expected = side === 'reviewed' ? '# ArchHub isolated native baseline fixture' : sourceInspection.scan.files.find(file => file.path === 'PKGBUILD').content.split('\n')[0];
          await waitFor(() => {
            const region = document.querySelector('section[aria-label="' + label + '"]');
            const code = region?.querySelector('code');
            const viewport = region?.querySelector('pre')?.parentElement;
            if (!region || document.activeElement !== region || code?.textContent !== expected || !viewport) return null;
            const line = code.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
            return line.top >= Math.max(bounds.top, 0) && line.bottom <= Math.min(bounds.bottom, innerHeight) ? code : null;
          }, 'native changed source line mismatch or clipped');
          const sideRegion = document.querySelector('section[aria-label="' + label + '"]');
          const sideSearch = sideRegion.querySelector('input[aria-label="Find in captured file"]');
          sideSearch.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sideSearch, expected.toUpperCase());
          sideSearch.dispatchEvent(new Event('input', {bubbles:true}));
          await waitFor(() => {
            const code = sideRegion.querySelector('code'), viewport = sideRegion.querySelector('pre')?.parentElement;
            if (document.activeElement !== sideSearch || code?.textContent !== expected || !viewport) return null;
            const line = code.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
            return line.top >= Math.max(bounds.top, 0) && line.bottom <= Math.min(bounds.bottom, innerHeight) ? code : null;
          }, 'native diff source search mismatch, clipped or focus lost');
          (await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Return to diff'), 'native diff return unavailable')).click();
          await waitFor(() => document.activeElement === action ? action : null, 'native diff focus did not return');
        }
        document.documentElement.dataset.changedLineSourceEvidence = 'rendered';
      }
      activateTab(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === 'Sources'), 'native source tab unavailable'));
      await waitFor(() => document.querySelector('section[aria-label="Source declaration evidence"]')?.textContent.includes('Source bytes not verified'), 'native source workspace unavailable');
      document.documentElement.dataset.sourcesEvidence = 'rendered';
      if (__ARCHHUB_SMOKE_CHANGES__) {
        [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.trim() === 'Close').click();
        await waitFor(() => !document.querySelector('[role="dialog"]') ? document.body : null, 'native recipe sheet did not close');
        window.location.hash = '/reviews';
        let row = await waitFor(() => document.querySelector('article[aria-label="Saved review for visual-studio-code-bin"]'), 'native saved row unavailable');
        const rowCheck = () => { const button = row.querySelector('button[aria-label="Check current recipe for visual-studio-code-bin"]'); return button && !button.disabled ? button : null; };
        if (__ARCHHUB_SMOKE_RECIPE_LIFECYCLE__) {
          let release;
          const gate = new Promise(resolve => { release = resolve; });
          let controlledFailure = true;
          let attempts = 0;
          const nativeFetch = window.fetch;
          window.fetch = async (url, options) => {
            const args = url === window.__TAURI_INTERNALS__.convertFileSrc('query', 'ipc') && typeof options?.body === 'string' ? JSON.parse(options.body) : null;
            if (args?.request?.command === 'recipe' && args.request.base === 'visual-studio-code-bin') {
              attempts++;
              await gate;
              if (controlledFailure) return new Response(JSON.stringify('Native controlled recipe failure'), {status:400, headers:{'Content-Type':'application/json','Tauri-Response':'error'}});
            }
            return nativeFetch.call(window, url, options);
          };
          try {
            (await waitFor(rowCheck, 'native lifecycle row check unavailable')).click();
            await waitFor(() => attempts === 1 && row.textContent.includes('Checking current recipe…') ? row : null, 'native recipe did not start');
            window.location.hash = '/history';
            await waitFor(() => document.querySelector('h1')?.textContent === 'Activity' ? document.body : null, 'native inactive recipe route unavailable');
            window.location.hash = '/reviews';
            row = await waitFor(() => document.querySelector('article[aria-label="Saved review for visual-studio-code-bin"]'), 'native pending recipe row did not reopen');
            await waitFor(() => row.textContent.includes('Checking current recipe…') && !rowCheck() ? row : null, 'native pending recipe was lost across navigation');
            row.querySelector('button[aria-label="Open evidence for visual-studio-code-bin"]').click();
            await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('Previous capture · current state unknown'), 'native pending capture remained current');
            activateTab(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === 'Review record'), 'native pending review tab unavailable'));
            const record = () => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.trim() === 'Record this review');
            await waitFor(() => document.querySelector('[role="dialog"] input[type="checkbox"]')?.disabled && record()?.disabled ? document.body : null, 'native pending capture could be acknowledged');
            release();
            await waitFor(() => document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Native controlled recipe failure'), 'native recipe string failure did not propagate');
            [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.trim() === 'Close').click();
            await waitFor(() => !document.querySelector('[role="dialog"]') ? document.body : null, 'native failed recipe sheet did not close');
            window.location.hash = '/history';
            await waitFor(() => document.querySelector('h1')?.textContent === 'Activity' ? document.body : null, 'native failed recipe inactive route unavailable');
            window.location.hash = '/reviews';
            row = await waitFor(() => document.querySelector('article[aria-label="Saved review for visual-studio-code-bin"]'), 'native failed recipe row did not reopen');
            await waitFor(() => row.textContent.includes('Current check failed · remote state unknown') ? row : null, 'native recipe failure was lost on reopening');
            if (attempts !== 1 || row.querySelector('button[aria-label="Review comparison for visual-studio-code-bin"]')) throw new Error('native failed recipe remained current or auto-scanned');
            controlledFailure = false;
            (await waitFor(rowCheck, 'native explicit recipe retry unavailable')).click();
            await waitFor(() => rowCheck() && row.textContent.includes('Changed since review') && row.textContent.includes('Captured ') ? row : null, 'native live recipe retry failed');
            if (attempts !== 2) throw new Error('native explicit recipe attempts duplicated');
            document.documentElement.dataset.recipeLifecycleEvidence = 'rendered';
          } finally {
            release();
            window.fetch = nativeFetch;
          }
        }
        const check = await waitFor(rowCheck, 'native row recheck unavailable');
        check.click();
        await waitFor(() => row.textContent.includes('Checking current recipe…') ? row : null, 'native row pending state unavailable');
        await waitFor(() => !check.disabled && row.textContent.includes('Changed since review') && row.textContent.includes('Captured ') ? row : null, 'native row recheck result unavailable');
        row.querySelector('button[aria-label="Review comparison for visual-studio-code-bin"]').click();
        await waitFor(() => [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find(tab => /^Changes \(/.test(tab.textContent.trim())), 'native row comparison handoff unavailable');
        await waitFor(() => document.querySelector('section[aria-label="Static finding changes"]')?.textContent.includes('Still reported (') ? document.body : null, 'native row finding evidence unavailable');
        document.documentElement.dataset.reviewRowEvidence = 'rendered';
      }
      if (foreignPackage) {
        [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.trim() === 'Close').click();
        await waitFor(() => !document.querySelector('[role="dialog"]') ? document.body : null, 'native source dialog did not close');
        window.location.hash = '/foreign';
        (await waitFor(() => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'View ' + foreignPackage.name), 'native foreign package unavailable')).click();
        activateTab(await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === 'Origin & trust'), 'native trust tab unavailable'));
        (await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Look up AUR recipe' && !button.disabled), 'native foreign lookup unavailable')).click();
        await waitFor(() => { const section=document.querySelector('section[aria-label="Foreign package recipe lookup"]'); return section && (section.textContent.includes('Exact-name AUR match') || section.textContent.includes('No exact-name AUR match')) ? section : null; }, 'native foreign lookup evidence unavailable');
        document.documentElement.dataset.foreignLookupEvidence = 'rendered';
        if (foreignLookup.aur) {
          (await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Inspect matching recipe' && !button.disabled), 'native foreign recipe handoff unavailable')).click();
          await waitFor(() => document.querySelector('[aria-label="Matching AUR recipe review"]'), 'native foreign recipe review unavailable');
          document.documentElement.dataset.foreignRecipeEvidence = 'rendered';
        }
      }
      for (let closeCount=0; closeCount<5 && document.querySelector('[role="dialog"]'); closeCount++) {
        const closeButton = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.trim() === 'Close');
        if (!closeButton) throw new Error('native inspection did not expose Close');
        closeButton.click();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      window.location.hash = '/maintenance';
      await waitFor(() => document.querySelector('h1')?.textContent === 'Maintenance' ? document.body : null, 'native Maintenance did not render');
      if (maintenance.checkupdatesAvailable) {
        (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check repositories online' && !b.disabled), 'native online check unavailable')).click();
        await waitFor(() => document.querySelector('section[aria-label="Online repository results"]')?.textContent.includes('version changes · checked') ? document.body : null, 'native online update result unavailable');
      }
      if (maintenance.foreign.length) {
        (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check foreign versions on AUR' && !b.disabled), 'native batch AUR check unavailable')).click();
        await waitFor(() => document.querySelector('section[aria-label="Foreign version results"]')?.textContent.includes('exact-name matches only') ? document.body : null, 'native batch AUR result unavailable');
      }
      const activateMaintenanceTab = label => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === label);
        if (!tab) throw new Error('native maintenance tab missing: ' + label);
        tab.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,button:0}));
        tab.click();
      };
      activateMaintenanceTab('Orphans');
      await waitFor(() => document.querySelector('section[aria-label="Orphan packages"]') ? document.body : null, 'native orphan workspace unavailable');
      activateMaintenanceTab('Disk usage');
      await waitFor(() => document.querySelector('section[aria-label="Largest installed packages"]')?.textContent.includes(maintenance.largest[0]?.name) ? document.body : null, 'native installed-size workspace unavailable');
      if (!document.querySelector('button[aria-label="Copy cache cleanup preview command"]') && maintenance.paccacheAvailable) throw new Error('native cache preview handoff unavailable');
      document.documentElement.dataset.maintenanceEvidence = 'rendered';
      const removalName = maintenance.largest[0].name;
      (await waitFor(() => document.querySelector('button[aria-label="View ' + removalName + '"]'), 'native removal package unavailable')).click();
      (await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Review removal of ' + removalName && !b.disabled), 'native removal review action unavailable')).click();
      await waitFor(() => document.querySelector('section[aria-label="Removal review"]')?.textContent.match(/Required dependency check passed|Removal is blocked by required dependencies/), 'native removal review did not render');
      document.documentElement.dataset.removalEvidence = 'rendered';
      if (removalTaskState.task?.id === 7 && removalTaskState.task.request.targets[0]?.name === 'archhub-native-fixture') {
        [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Close')?.click();
        window.location.hash = '/history';
        await waitFor(() => document.querySelector('section[aria-label="Removal task outcome"]')?.textContent.includes('Removal needs attention') ? document.body : null, 'native restored removal outcome did not render');
        if (removalTaskState.task.status !== 'unknown') throw new Error('unfinished native record was not restored as unknown');
        document.documentElement.dataset.removalRecoveryEvidence = 'rendered';
      }
      await write(output);
      document.documentElement.dataset.nativeSmoke = 'passed';
      setTimeout(() => invoke('plugin:window|set_title', {label:'main',value:'ArchHub smoke PASSED: ' + snapshot.installedCount + ' installed packages'}), 1000);
    } catch(error) {
      await window.__TAURI_INTERNALS__.invoke('plugin:fs|write_text_file', new TextEncoder().encode(JSON.stringify({passed:false,error:String(error),route:window.location.hash,displayedText:document.body.innerText},null,2)), {headers:{path:encodeURIComponent(__ARCHHUB_SMOKE_PATH__),options:'{}'}});
      await window.__TAURI_INTERNALS__.invoke('plugin:window|set_title', {label:'main',value:'ArchHub smoke FAILED: ' + String(error)});
    }
  }, 100);
})();
"#;

const PREPARATION_SCRIPT: &str = r#"
(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const write = value => invoke('plugin:fs|write_text_file', new TextEncoder().encode(JSON.stringify(value, null, 2)), {headers:{path:encodeURIComponent(__ARCHHUB_SMOKE_PATH__),options:'{}'}});
  const wait = async (read, label) => {
    for (let i=0; i<1200; i++) { const result=read(); if(result) return result; await new Promise(r=>setTimeout(r,100)); }
    throw new Error(label);
  };
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  try {
    await wait(() => document.querySelector('h1'), 'UI unavailable');
    const snapshot = await invoke('query', {request:{command:'snapshot',refresh:true}});
    let staleRejected=false;
    try { await invoke('query', {request:{command:'update_preparation',fingerprint:'stale'}}); } catch { staleRejected=true; }
    if (!staleRejected) throw new Error('stale preparation identity accepted');
    window.location.hash='/updates';
    const check=await wait(()=>button('Check update readiness'), 'preparation action unavailable');
    await wait(()=>!check.disabled, 'inventory unavailable');
    if (!button('Copy full updater command')?.disabled) throw new Error('unchecked capture offered handoff');
    check.click();
    await wait(()=>[...document.querySelectorAll('output')].some(o=>o.textContent==='Checks captured — review required'), 'complete preparation capture unavailable');
    const title=[...document.querySelectorAll('li button')].find(b=>b.textContent.includes('manual intervention'))?.textContent;
    if (!title) throw new Error('official notices did not render');
    const boxes=[...document.querySelectorAll('input[type=checkbox]')];
    if (boxes.length!==2 || boxes.some(b=>b.disabled)) throw new Error('review controls unavailable');
    boxes[0].click();
    await new Promise(r=>setTimeout(r,100));
    if (!button('Copy full updater command').disabled) throw new Error('partial review offered handoff');
    boxes[1].click();
    await wait(()=>!button('Copy full updater command').disabled, 'reviewed handoff unavailable');
    const command=document.querySelector('section code').textContent;
    if (command!==(snapshot.omarchy?'omarchy update':'sudo pacman -Syu')) throw new Error('unsupported updater command');
    button('Copy full updater command').click();
    await wait(()=>document.body.innerText.includes('Updater command copied'), 'native clipboard handoff failed');
    button('Check update readiness').click();
    await wait(()=>[...document.querySelectorAll('output')].some(o=>o.textContent==='Checks captured — review required'), 'recheck did not complete');
    if ([...document.querySelectorAll('input[type=checkbox]')].some(b=>b.checked) || !button('Copy full updater command').disabled) throw new Error('recheck preserved old acknowledgments');
    const capture=await invoke('query', {request:{command:'update_preparation',fingerprint:snapshot.fingerprint}});
    if (!capture.repositories || !capture.news || capture.repositoryError || capture.newsError || capture.fingerprint!==snapshot.fingerprint) throw new Error('native preparation IPC incomplete');
    await write({passed:true,staleRejected,nativeWorkspaceRendered:true,newsTitle:title,clipboardHandoff:true,recheckReset:true,snapshot,preparation:capture});
    document.title='ArchHub preparation smoke PASSED';
  } catch(error) { await write({passed:false,error:String(error),displayedText:document.body.innerText}); document.title='ArchHub preparation smoke FAILED'; }
})();
"#;
