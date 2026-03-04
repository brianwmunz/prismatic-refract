/**
 * integration/src/configPages.ts
 *
 * Defines the configuration wizard a user walks through when deploying
 * an instance of Refract. All sensitive values are stored encrypted by
 * Prismatic — they are never visible after being entered.
 *
 * These values are accessed in flows via:
 *   util.types.toString(context.configVars["Key Name"])
 */

import { configPage, configVar } from "@prismatic-io/spectral";

export const configPages = {
  "Refract Configuration": configPage({
    tagline: "Connect Refract to your Anthropic and Slack accounts.",
    elements: {
      "Anthropic API Key": configVar({
        stableKey: "anthropic-api-key",
        dataType: "string",
        description:
          "Your Anthropic API key (starts with sk-ant-). " +
          "Get one at console.anthropic.com. " +
          "Store it as an environment variable locally — never paste it in chat.",
      }),

      "Slack Bot Token": configVar({
        stableKey: "slack-bot-token",
        dataType: "string",
        description:
          "OAuth bot token for your Slack app (starts with xoxb-). " +
          "The bot needs chat:write and reactions:read scopes.",
      }),

      "Slack Channel ID": configVar({
        stableKey: "slack-channel-id",
        dataType: "string",
        description:
          "The channel ID (not name) for #community-engagement. " +
          "Right-click the channel in Slack → View channel details to find it.",
      }),

      "Minimum Score": configVar({
        stableKey: "minimum-score",
        dataType: "string",
        description:
          "Mentions with a combined score below this value are dropped silently. " +
          "Default: 5. Raise to reduce noise, lower to see more.",
        defaultValue: "5",
      }),

      "Reddit Username": configVar({
        stableKey: "reddit-username",
        dataType: "string",
        description:
          "Your Reddit username (without the u/ prefix). " +
          "Posts and comments from this account will be skipped so your own activity " +
          "doesn't get scored. Leave blank to disable filtering.",
        defaultValue: "",
      }),
    },
  }),
};
