/** Every statement the grow feed runs. feed-memory.js answers the same strings for tests and the local server. */

const POST_COLUMNS = "grow_posts.*, users.username AS author";

export const FEED_SQL = {
  insertPost:
    "INSERT INTO grow_posts (user_id, profile_id, device_id, grow_day, note, photo_key, content_type, width, height, status, report_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', 0, ?, ?)",
  postByKey: "SELECT * FROM grow_posts WHERE photo_key=?",
  postById: `SELECT ${POST_COLUMNS} FROM grow_posts JOIN users ON users.id = grow_posts.user_id WHERE grow_posts.id=?`,
  feedPage: `SELECT ${POST_COLUMNS} FROM grow_posts JOIN users ON users.id = grow_posts.user_id WHERE grow_posts.status='visible' AND grow_posts.id < ? ORDER BY grow_posts.id DESC LIMIT ?`,
  profilePage: `SELECT ${POST_COLUMNS} FROM grow_posts JOIN users ON users.id = grow_posts.user_id WHERE grow_posts.status='visible' AND grow_posts.profile_id=? AND grow_posts.id < ? ORDER BY grow_posts.id DESC LIMIT ?`,
  moderationQueue: `SELECT ${POST_COLUMNS} FROM grow_posts JOIN users ON users.id = grow_posts.user_id WHERE grow_posts.status='hidden' OR (grow_posts.status='visible' AND grow_posts.report_count > 0) ORDER BY grow_posts.id DESC LIMIT 100`,
  insertReport: "INSERT OR IGNORE INTO grow_post_reports (post_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)",
  bumpReports: "UPDATE grow_posts SET report_count=report_count+1, updated_at=? WHERE id=?",
  setStatus: "UPDATE grow_posts SET status=?, updated_at=? WHERE id=?",
  restore: "UPDATE grow_posts SET status='visible', report_count=0, updated_at=? WHERE id=?",
};
