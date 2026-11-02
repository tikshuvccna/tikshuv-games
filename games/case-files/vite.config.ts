import { defineGame } from '../../tools/defineGame';

const base = defineGame({ id: 'case-files', root: import.meta.dirname, pages: ['design-system.html'] });

// Two HTML entries share the ui package CSS; without this Vite attaches the shared stylesheet to only one page.
export default { ...base, build: { ...base.build, cssCodeSplit: false } };
