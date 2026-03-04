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
 *   Prismatic Relevance — select  (High (mentioned) | Medium (Adjacent) | Low (Reputation))
 *   Responded At        — date
 */

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION  = "2022-06-28";

export type PrismaticRelevance =
  | "High (mentioned)"   // Prismatic was named or linked — direct opportunity
  | "Medium (Adjacent)"  // Topic is in Prismatic's space but not name-dropped
  | "Low (Reputation)";  // General community engagement, off-topic

export interface NotionEngagementEntry {
  postTitle:          string;
  postUrl:            string;
  platform:           string;
  platformSub:        string;
  score:              number;
  engagementType:     "general" | "prismatic";
  prismaticRelevance: PrismaticRelevance;
  respondedAt:        string; // ISO 8601 date string
}

/**
 * Derive the Prismatic Relevance tier from scoring fields.
 *
 *   prismatic_opportunity = true           → High (mentioned)
 *   engagement_type = "prismatic"          → Medium (Adjacent)
 *   engagement_type = "general"            → Low (Reputation)
 */
export function derivePrismaticRelevance(
  engagementType: "general" | "prismatic",
  prismaticOpportunity: boolean
): PrismaticRelevance {
  if (prismaticOpportunity)            return "High (mentioned)";
  if (engagementType === "prismatic")  return "Medium (Adjacent)";
  return "Low (Reputation)";
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
      "Prismatic Relevance": {
        select: { name: entry.prismaticRelevance },
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
