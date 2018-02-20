const fs = require("fs");
const path = require('path');
const webpack = require('webpack');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

let banner = fs.readFileSync('./banner.txt', "utf8");

module.exports = {
    entry: {
        'dolphin-platform': './src/index.js',
        'dolphin-platform.min': './src/index.js'
    },
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        library: 'platformClient',
        libraryTarget: 'umd',
        //umdNamedDefine: true
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules|bower_components)/,
                use: {
                    loader: 'babel-loader'
                }
            }
        ]
    },
    plugins: [
        new UglifyJsPlugin({
            include: /\.min\.js$/,
            sourceMap: true
        }),
        new webpack.DefinePlugin({
            DOLPHIN_PLATFORM_VERSION: JSON.stringify(require("./package.json").version)
        }),
        new webpack.BannerPlugin(banner)
    ]
};
