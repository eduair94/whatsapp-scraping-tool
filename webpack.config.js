// Bundles the window (React) into dist/renderer. The main process is plain
// TypeScript output (tsc), not bundled.
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (_env, argv) => {
  const production = argv.mode !== 'development';
  return {
    mode: production ? 'production' : 'development',
    // The window is sandboxed and has no Node: it is an ordinary web page.
    target: 'web',
    entry: './src/renderer/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist/renderer'),
      filename: 'app.js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: { loader: 'ts-loader', options: { configFile: 'tsconfig.renderer.json' } },
        },
        // A real stylesheet file, so the page needs no inline styles (strict CSP).
        { test: /\.css$/i, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
        // Fonts ride inside the stylesheet: nothing is fetched at run time.
        { test: /\.woff2$/i, type: 'asset/inline' },
      ],
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    plugins: [
      new HtmlWebpackPlugin({ template: 'src/renderer/index.html', filename: 'index.html', scriptLoading: 'defer' }),
      new MiniCssExtractPlugin({ filename: 'app.css' }),
    ],
    // No source maps in the packaged app.
    devtool: production ? false : 'source-map',
    performance: { hints: false },
    stats: 'errors-warnings',
  };
};
