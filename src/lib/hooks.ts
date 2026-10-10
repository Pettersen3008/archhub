import { useEffect, useState } from "react";
export function useDebounce<T>(value: T, delay = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
export function useStored<T>(
  key: string,
  initial: T,
  validate?: (value: unknown) => value is T,
): [T, (value: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : initial;
      return !validate || validate(parsed) ? (parsed as T) : initial;
    } catch {
      return initial;
    }
  });
  function update(next: T | ((previous: T) => T)) {
    setValue((previous) => {
      const value = next instanceof Function ? next(previous) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Preferences remain usable in memory when storage is unavailable. */
      }
      return value;
    });
  }
  return [value, update];
}
