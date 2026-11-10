/** The app's single game store, set up from the URL and any saved game. Browser only. */
import { parseUrlOptions } from './session.js';
import { createGameStore, initialSession } from './store.js';

export const urlOptions = parseUrlOptions(window.location.search);

export const useGame = createGameStore(initialSession(urlOptions), urlOptions.fast);
