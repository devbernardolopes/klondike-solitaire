// data/achievements.js
// Static catalog of achievements the app knows how to display. These ids must
// match the check constraints / award logic in klondike_supabase_migration_002.sql
// (submit_game_result currently awards won_under_100_moves and 10_win_streak into
// achievements_unlocked). Names/descriptions/icons intentionally live here, not in
// the DB (the table only stores which ids a user has earned). To add a new
// achievement: add the server-side award in the SQL AND a matching entry here.

/**
 * @typedef {Object} AchievementDef
 * @property {string} id           matches achievements_unlocked.achievement_id
 * @property {string} name
 * @property {string} description
 */

/** @type {AchievementDef[]} */
export const ACHIEVEMENTS = [
  {
    id: 'won_under_100_moves',
    name: 'Efficient Win',
    description: 'Win a game in under 100 moves.',
  },
  {
    id: '10_win_streak',
    name: 'On a Roll',
    description: 'Reach a 10-game win streak.',
  },
];
