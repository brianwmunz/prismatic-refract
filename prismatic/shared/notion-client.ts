/**
 * notion-client.ts
 *
 * Thin wrapper around the Notion API for creating engagement log entries.
 *
 * Uses the Notion Pages API to append a row to a database:
 *   POST https://api.notion.com/v1/pages
 *
 * The database must be shared with your Notion integration and have
 * the following properties (exact names matter):
 *
 *   Post Title        — title
 *   Post URL          — url
 *   Platform          — rich_text
 *   Community         — rich_text    (subreddit, publication, etc.)
 *   Score             — number
 *   Type              — select       (general | prismatic)
 *   Prismatic Win     — checkbox
 *   Responded At      — date
 */

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION  = "2022-06-28";

export interface NotionEngagementEntry {
  postTitle:            string;
  postUrl:              string;
  platform:             string;
  platformSub:          string;
  score:                number;
  engagementType:       "general" | "prismatic";
  prismaticOpportunity: boolean;
  respondedAt:          string; // ISO 8601 date string
}

/**
 * Create a new row in the engagement log Notion database.
 *
 * @param token      - Notion integration token (starts with secret_)
 * @param databaseId - ID of the Notion database to write to
 * @param entry      - The engagement data to log
 */
export async function createNotionEntry(
  token: string,
  databaseId: string,
  entry: NotionEngagementEntry
): Promise<void> {
  const body = {
    parent: { database_id: databaseId },
    properties: {
      "Post Title": {
        title: [{ text: { content: entry.postTitle } }],
      },
      "Post URL": {
        url: entry.postUrl,
      },
      "Platform": {
        rich_text: [{ text: { content: entry.platform } }],
      },
      "Community": {
        rich_text: [{ text: { content: entry.platformSub } }],
      },
      "Score": {
        number: entry.score,
      },
      "Type": {
        select: { name: entry.engagementType },
      },
      "Prismatic Win": {
        checkbox: entry.prismaticOpportunity,
      },
      "Responded At": {
        date: { start: entry.respondedAt },
      },
    },
  };

  const response = await fetch(`${NOTION_API_BASE}/pages`, {
    method: "POST",
    headers: {
      "Authorization":  `Bearer ${token}`,
      "Content-Type":   "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[notion-client] Notion API error ${response.status}: ${text.slice(0, 200)}`);
  }
}
