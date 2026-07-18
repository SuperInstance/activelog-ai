# DMlog.ai Custom Configuration

This directory contains the custom configuration for the DMlog.ai themed fork of log-origin.

## Structure

```
config/custom/
├── personality.md      # System prompt defining the DM persona
├── rules.json          # Routing rules for TTRPG commands
├── theme.css           # Fantasy-themed CSS overrides
├── templates/          # Prompt templates for D&D 5e
│   ├── dnd_character.md
│   ├── dnd_combat.md
│   ├── dnd_npc.md
│   ├── dnd_description.md
│   ├── dnd_rules.md
│   ├── dnd_loot.md
│   ├── dnd_rest.md
│   └── dnd_social.md
├── .gitattributes      # Merge strategy for upstream updates
└── README.md           # This file
```

## Customization Guide

### 1. Personality (System Prompt)
Edit `personality.md` to adjust the DM's voice, tone, or knowledge base. This file is loaded as the default system prompt when DMlog.ai starts.

### 2. Routing Rules
Edit `rules.json` to add or modify command routing. Each rule includes:
- `pattern`: Regex pattern to match user input
- `template`: Which template to use (or null for local handlers)
- `action`: "cheap", "escalation", "compare", or "local"
- `confidence`: Match confidence (0.0-1.0)

### 3. Theme
Edit `theme.css` to change colors, fonts, or styling. The theme is applied when the `dm-theme` class is present on the body element.

### 4. Templates
Add new templates in `templates/` directory. Each template should:
- Have a `.md` extension
- Include YAML frontmatter with `name`, `key`, `icon`, and `description`
- Contain system prompt, variable placeholders, and examples

### 5. Merge Strategy
The `.gitattributes` file ensures safe merging with upstream log-origin:
- `app/` takes upstream changes (`merge=theirs`)
- `config/custom/` keeps our changes (`merge=ours`)
- `docs/` takes upstream changes (`merge=theirs`)

## Deployment

When deploying DMlog.ai, ensure:
1. The custom config directory is bundled with the worker
2. `wrangler.toml` points to the custom paths:
   ```toml
   [vars]
   PERSONALITY_PATH = "config/custom/personality.md"
   RULES_PATH = "config/custom/rules.json"
   THEME_PATH = "config/custom/theme.css"
   TEMPLATES_DIR = "config/custom/templates/"
   ```

## Updating from Upstream

To safely merge upstream log-origin changes:

```bash
git fetch origin
git merge origin/main
```

The `.gitattributes` file will handle conflicts automatically:
- App code changes from upstream will be accepted
- Custom config changes will be preserved
- Manual review may be needed for overlapping changes

## Adding New Features

1. **New Template:** Add `.md` file to `templates/`, update `rules.json`
2. **New Handler:** Add JavaScript handler in `handlers/`, reference in `rules.json`
3. **Theme Extension:** Add CSS to `theme.css` or create new CSS file
4. **Personality Mode:** Add new tone variant to `personality.md`

## Troubleshooting

- **Theme not loading:** Check `body` element has `dm-theme` class
- **Templates not appearing:** Verify frontmatter format and file extension
- **Rules not matching:** Test regex patterns at https://regex101.com/
- **Merge conflicts:** Run `git checkout --ours config/custom/` to keep custom changes