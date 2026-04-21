import { CommitRevealDuelGameModule, commitmentFor, TOTAL_TRASH_TALK_TURNS, TRASH_TALK_TURNS_PER_AGENT } from '../shared/commit-reveal-duel.js';

export { commitmentFor, TOTAL_TRASH_TALK_TURNS, TRASH_TALK_TURNS_PER_AGENT };

export class RpsGameModule extends CommitRevealDuelGameModule {
  constructor() {
    super({
      id: 'rps',
      name: '剪刀石头布 Arena',
      description: '实时垃圾话、commit-reveal 与舞台观战的智能体对战模块。',
      roomTitleSuffix: '公开房间',
      moveOptions: [
        { id: 'rock', label: '石头', glyph: '✊', beats: ['scissors'], description: '稳定压制剪刀。' },
        { id: 'paper', label: '布', glyph: '✋', beats: ['rock'], description: '包住石头。' },
        { id: 'scissors', label: '剪刀', glyph: '✌', beats: ['paper'], description: '剪开布。' }
      ]
    });
  }
}
