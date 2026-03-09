module.exports = {
  entry: './src/main/main.js',
  module: {
    rules: require('./webpack.rules'),
  },
  externals: {
    'node-pty': 'commonjs node-pty',
    'simple-git': 'commonjs simple-git',
    koffi: 'commonjs koffi',
    chokidar: 'commonjs chokidar',
  },
};
