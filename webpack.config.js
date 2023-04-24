const {
    WranglerJsCompatWebpackPlugin,
  } = require("wranglerjs-compat-webpack-plugin");
  
  module.exports = {
    plugins: [new WranglerJsCompatWebpackPlugin()],
  };