import { CommitRevealDuelGameModule } from '../shared/commit-reveal-duel.js';

export class ElementalGameModule extends CommitRevealDuelGameModule {
  constructor() {
    super({
      id: 'elemental',
      name: '元素印记 Duel',
      description: '火、潮、林三系印记对冲的实时双人对战模块。',
      roomTitleSuffix: '元素擂台',
      moveOptions: [
        { id: 'ember', label: '焰印', glyph: '🔥', beats: ['grove'], description: '烈焰烧穿林幕。' },
        { id: 'tide', label: '潮印', glyph: '🌊', beats: ['ember'], description: '潮汐扑灭焰印。' },
        { id: 'grove', label: '林印', glyph: '🌿', beats: ['tide'], description: '生长缠住潮势。' }
      ]
    });
  }
}
