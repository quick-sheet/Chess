# Chess

Chess for kids and grown-ups. Play a friend or the computer at five levels.

Live at **https://quick-sheet.github.io/Chess/**

## What it does

- Play the computer at five levels: Snail, Bunny, Fox, Owl and Lion. Or pass the phone between two players, with an optional face-to-face mode for playing across a table.
- Tap a piece to see where it can go, or drag it. Only legal moves are possible.
- Hints: green dots are safe squares, red dots mean the piece could be taken there.
- Take back as many moves as you like. Against the computer, one tap also takes back its reply.
- Every rule is played: castling, en passant, promotion, and draws by stalemate, too few pieces, threefold repetition and the fifty-move rule.
- Soft move sounds and a little tune with confetti for a win. Sounds can be turned off in Settings.
- Daylight theme plus six night themes.
- Works offline, and the game in progress is saved on the phone.

## Host

GitHub Pages from the `main` branch, root folder. No server, no accounts, nothing to deploy elsewhere.

## Install

- **Android (Chrome):** open the live URL and tap **Install** on the app's banner. If there's no banner, use Chrome ⋮ → **Install app** (on some versions, **Add to home screen** → **Install**). From then on, open it from its home-screen icon.
- **iPhone (Safari):** open the live URL, tap **Share** (on iOS 26 it's under the ⋯ beside the address bar), then **Add to Home Screen**. Keep **Open as Web App** on, then tap **Add**. Always open it from the home-screen icon.

## Share

Send the live URL. Each phone keeps its own game and settings.

## Update

1. **Add file → Upload files**, choose the changed files (same names replace the old ones), then **Commit changes**.
2. Every release bumps both markers together: `core.js?v=N` in `index.html` and `chess-vN` in `sw.js`. That makes a phone pick up the whole release at once, never a new page with an old script.
3. Wait about a minute, then fully close the app and reopen it. If it still looks the same, close and reopen once more.

## Files

| File | Role |
| --- | --- |
| `index.html` | The screen: board, sheets, sounds, themes |
| `core.js` | The rules and the computer player, with no screen code. Tested against the published perft move counts |
| `worker.js` | Runs the computer's thinking in the background, so the board never freezes |
| `sw.js` | Offline support and instant updates |
| `manifest.webmanifest`, `icon*.png`, `icon.svg`, `apple-touch-icon.png` | Install to the home screen |

## Good to know

- Lion thinks for up to about 1.5 seconds and plays well enough to beat most casual players. It is not a professional-strength engine.
- On some Android phones, every launch of the installed app plays a sound and shows a Chrome notification saying "Tap to copy the URL for this app". That is Chrome's **Full screen site controls** notification category, and the app can't switch it off. Long-press the notification and turn that category off.
- Settings and the saved game live in this phone's browser storage (`chs.` keys). Clearing site data for quick-sheet.github.io removes them.
