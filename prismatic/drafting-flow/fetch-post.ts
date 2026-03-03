/**
 * drafting-flow/fetch-post.ts
 *
 * Fetches the full content of a post from its source platform so Claude
 * has richer context when drafting a reply — the full body plus top
 * comments rather than just Syften's 150-char snippet.
 *
 * Currently supports:
 *   - Reddit  (uses Reddit's public JSON API — no auth required)
 *
 * Returns null if the platform isn't supported or the fetch fails.
 * The drafting flow degrades gracefully: Claude still drafts using the
 * snippet from the scored message metadata.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to fetch full post content for a given URL.
 *
 * @param url      - The item_url from the Syften mention
 * @param platform - The backend field ("Reddit", "HackerNews", etc.)
 * @returns A formatted string of post + top comments, or null on failure
 */
export async function fetchPostContent(
  url: string,
  platform: string
): Promise<string | null> {
  if (platform.toLowerCase() === "reddit") {
    return fetchRedditPost(url);
  }

  // Other platforms can be added here as the project grows
  console.log(`[fetch-post] No fetcher implemented for platform: ${platform}`);
  return null;
}

// ---------------------------------------------------------------------------
// Reddit fetcher
// ---------------------------------------------------------------------------

// Reddit's public JSON API: append .json to any post URL.
// No API key needed for public posts. Rate limit: ~60 req/min unauthenticated.
// Adding ?raw_json=1 prevents Reddit from HTML-encoding special characters.

interface RedditPostData {
  title: string;
  selftext: string;
  author: string;
  score: number;
  url: string;
  num_comments: number;
}

interface RedditCommentData {
  author: string;
  body: string;
  score: number;
}

interface RedditListing<T> {
  data: {
    children: Array<{ kind: string; data: T }>;
  };
}

async function fetchRedditPost(url: string): Promise<string | null> {
  // Normalise the URL: strip trailing slash, then add .json
  const jsonUrl = url.replace(/\/?$/, "") + ".json?raw_json=1";

  let response: Response;
  try {
    response = await fetch(jsonUrl, {
      headers: {
        // Reddit requires a non-empty User-Agent or returns 429
        "User-Agent": "Refract DevRel Bot/1.0",
      },
    });
  } catch (err) {
    console.warn(`[fetch-post] Network error fetching Reddit post: ${err}`);
    return null;
  }

  if (!response.ok) {
    console.warn(`[fetch-post] Reddit returned HTTP ${response.status} for ${jsonUrl}`);
    return null;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    console.warn("[fetch-post] Reddit response was not valid JSON");
    return null;
  }

  return formatRedditContent(json);
}

/**
 * Pull the post body and top comments out of Reddit's deeply nested
 * response structure and format them as plain text for Claude.
 *
 * Reddit's JSON API returns an array of two "listings":
 *   [0] = the post itself
 *   [1] = the comment tree
 */
function formatRedditContent(json: unknown): string | null {
  if (!Array.isArray(json) || json.length < 2) return null;

  const postListing = json[0] as RedditListing<RedditPostData>;
  const commentListing = json[1] as RedditListing<RedditCommentData>;

  const post = postListing?.data?.children?.[0]?.data;
  if (!post) return null;

  const lines: string[] = [
    `Title: ${post.title}`,
    `Author: u/${post.author}  |  Score: ${post.score}  |  Comments: ${post.num_comments}`,
    ``,
    post.selftext || "(no post body — link post or image)",
  ];

  // Include the top 5 comments by score for context, skipping deleted/removed
  const comments = (commentListing?.data?.children ?? [])
    .map((c) => c.data)
    .filter(
      (c): c is RedditCommentData =>
        typeof c.body === "string" &&
        c.body !== "[deleted]" &&
        c.body !== "[removed]"
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (comments.length > 0) {
    lines.push(``);
    lines.push(`--- TOP COMMENTS ---`);
    for (const comment of comments) {
      lines.push(``);
      lines.push(`u/${comment.author} (score: ${comment.score}):`);
      lines.push(comment.body);
    }
  }

  return lines.join("\n");
}
