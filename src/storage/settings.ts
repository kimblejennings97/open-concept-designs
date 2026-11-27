/** Small per-browser preferences in localStorage. Every access is guarded: storage can be blocked or missing. */
const PREFIX = 'ocd.';

function get(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    /* ignore */
  }
}

export const getUnitsPref = (): string | null => get('units');
export const setUnitsPref = (u: string): void => set('units', u);

export const getLastDesignId = (): string | null => get('lastDesignId');
export const setLastDesignId = (id: string | null): void => set('lastDesignId', id);
