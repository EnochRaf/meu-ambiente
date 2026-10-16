// Where the dev tools find Chrome: $CHROME, or the usual place on macOS, Linux or Windows.
import { existsSync } from 'node:fs';
const CANDIDATES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
export const CHROME = process.env.CHROME || CANDIDATES.find((p) => existsSync(p)) || CANDIDATES[0];
