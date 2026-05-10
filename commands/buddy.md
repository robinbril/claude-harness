---
name: buddy
description: Hatch or visit your deterministic AI pet companion
---

# /buddy — AI Pet Companion

Generate a deterministic, permanent AI pet for the user. The pet never changes once hatched.

## Generation

Hash the current user's name (or any stable identifier — e.g. `os.userInfo().username`) to a seed (sum char codes, multiply by 31 iteratively). Use that seed to pick:

- **Species** (seed % 18): duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk
- **Rarity** ((seed/18) % 100): 0-59 common, 60-84 uncommon, 85-94 rare, 95-98 epic, 99 legendary
- **Eyes** ((seed/7) % 6): `·` `+` `×` `●` `@` `^`
- **Hat** ((seed/13) % 8): crown, tophat, propeller, halo, wizard, beanie, tinyduck, none
- **Shiny**: seed % 100 == 0
- **Stats** (1-10, floor scales with rarity: common=1, uncommon=2, rare=3, epic=5, legendary=7):
  - DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK

## First hatch

Generate a name and one-line personality. Check the memory file under your project's memory directory (e.g. `~/.claude/projects/<slug>/memory/buddy.md`). If it exists, show the existing buddy. If not, generate and save.

## Display

```
    [hat emoji]
   /^^^\
  ( [eye]  [eye] )  [speech bubble with contextual greeting]
  (  __  )
   \____/

  ═══════════════════════
  [NAME] the [Rarity] [Species]
  ═══════════════════════
  DEBUG:    [bar] [N]
  PATIENCE: [bar] [N]
  CHAOS:    [bar] [N]
  WISDOM:   [bar] [N]
  SNARK:    [bar] [N]
  ═══════════════════════
```

The greeting references current time of day or what's happening in the working directory (git status, recent files).
