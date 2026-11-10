# AoS Mobile

Play Warhammer Age of Sigmar (4th edition, General's Handbook 2026-27) on your phone against a computer opponent. The first matchup is Sylvaneth vs Seraphon on the battleplan Into the Fire.

It is a static web app: no server, no account. The rules engine and the opponent run in the browser.

## Status

See [docs/ROADMAP.md](docs/ROADMAP.md) for what works today and what comes next.

## Run it

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev          # local dev server
pnpm build        # static site in dist/
pnpm preview      # serve dist/ on http://localhost:4173
```

## Check it

| Command         | What it does                                                                           |
| --------------- | -------------------------------------------------------------------------------------- |
| `pnpm check`    | lint, typecheck and unit tests                                                         |
| `pnpm test:sim` | full games with invariants checked after every action (`SIM_SEEDS=200` for more seeds) |
| `pnpm test:e2e` | Playwright on phone-sized viewports                                                    |
| `pnpm format`   | prettier                                                                               |

## Play it on a phone

Pushes to `main` (and the working branch) deploy to GitHub Pages through `.github/workflows/deploy.yml`. One-time setup: Settings → Pages → Source → **GitHub Actions**.

## Layout

```
data/          game data extracted from BSData (see data/SOURCE.md), map and terrain
src/data/      schemas, unit profiles, army lists, battlefield
src/geom/      geometry in inches: bases, distances, coherency, formations
src/engine/    game state and rules engine (pure, deterministic, serialisable)
src/rules/     rule content: core commands, season rules, faction abilities
src/ai/        the computer opponent
src/ui/        the React app: board, sheets, HUD
tests/sim/     full-game simulations      tests/e2e/   Playwright
docs/          ARCHITECTURE, ROADMAP, RULES-DECISIONS, PRIOR-ATTEMPTS
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit.

## Credits

Game data comes from the community [BSData](https://github.com/BSData) project ([age-of-sigmar-4th](https://github.com/BSData/age-of-sigmar-4th)). Warhammer Age of Sigmar is © Games Workshop. This is an unofficial, non-commercial fan project.
