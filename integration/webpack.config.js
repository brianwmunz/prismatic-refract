const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const Dotenv = require("dotenv-webpack");

module.exports = {
  // "development" disables minification, which prevents webpack from
  // tree-shaking internals out of SDKs like @anthropic-ai/sdk that use
  // dynamic method dispatch patterns. Production minification was causing
  // "(void 0) is not a function" errors at runtime.
  mode: "development",
  target: "node",
  plugins: [
    new CopyPlugin({
      patterns: [{ from: "assets", to: path.resolve(__dirname, "dist") }],
    }),
    new Dotenv(),
  ],
  module: {
    rules: [
      {
        test: /\.ts/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.md$/,
        type: "asset/source",
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    // Allow imports like "../../prismatic/shared/types.js" to resolve to .ts files.
    // Our business logic uses NodeNext-style .js extensions for ESM compatibility,
    // but webpack resolves them at build time so the .js suffix just works.
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    // Let webpack find node_modules from the project root (parent directory)
    // so shared dependencies like @anthropic-ai/sdk don't need to be duplicated.
    modules: ["node_modules", path.resolve(__dirname, "../node_modules")],
  },
  optimization: {
    // Don't remove exports that appear unused — needed for SDK compatibility
    usedExports: false,
  },
  entry: "./src/index.ts",
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist"),
    libraryTarget: "commonjs2",
  },
};
