/**
 * DMlog.ai custom assets and configuration endpoints.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../src/types.js';
import { getThemeCSS, getRoutingRules, getTemplate } from '../app-config.js';

const appRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Serve theme CSS
appRoutes.get('/theme.css', async (c) => {
  const theme = await getThemeCSS(c.env);
  if (!theme) {
    return c.json({ error: 'Theme not found' }, 404);
  }
  return c.text(theme, 200, { 'Content-Type': 'text/css' });
});

// Get routing rules
appRoutes.get('/rules', async (c) => {
  const rules = await getRoutingRules(c.env);
  return c.json({ rules });
});

// Get template by key
appRoutes.get('/templates/:key', async (c) => {
  const key = c.req.param('key');
  const template = await getTemplate(key, c.env);
  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }
  return c.text(template, 200, { 'Content-Type': 'text/markdown' });
});

// List available templates
appRoutes.get('/templates', async (c) => {
  // This would need to be implemented to scan the templates directory
  const templates = [
    { key: 'dnd_character', name: 'Character Creation', icon: '🧙', description: 'Generate a full D&D 5e character sheet with backstory' },
    { key: 'dnd_combat', name: 'Combat Encounter', icon: '⚔️', description: 'Track initiative, resolve attacks, and manage combat rounds' },
    { key: 'dnd_npc', name: 'NPC Generation', icon: '🎭', description: 'Create memorable NPCs with personality, stats, and dialogue' },
    { key: 'dnd_description', name: 'Scene Description', icon: '🏰', description: 'Generate immersive atmospheric descriptions for locations and scenes' },
    { key: 'dnd_rules', name: 'Rules Lookup', icon: '📖', description: 'Look up D&D 5e rules with source citations' },
    { key: 'dnd_loot', name: 'Loot Generation', icon: '💰', description: 'Generate treasure hoards and loot based on challenge rating' },
    { key: 'dnd_rest', name: 'Rest Mechanics', icon: '🛌', description: 'Track short and long rest mechanics, hit dice, and recovery' },
    { key: 'dnd_social', name: 'Social Interaction', icon: '💬', description: 'Adjudicate social interactions and NPC reactions' },
  ];
  return c.json({ templates });
});

export default appRoutes;