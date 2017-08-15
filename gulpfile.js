"use strict";

require('babel-register');
var os = require('os');
os.tmpDir = os.tmpdir;
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var assign = require('lodash.assign');
var browserify = require('browserify');
var buffer = require('vinyl-buffer');
var del = require('del');
var glob = require('glob');
var istanbul = require('browserify-istanbul');
var source = require('vinyl-source-stream');
var tsify = require('tsify');
var watchify = require('watchify');
var Server = require('karma').Server;
var config = typeof $.util.env['configFile'] === 'string' ? require($.util.env['configFile']) : {};

var testBundler = browserify(assign({}, watchify.args, {
    entries: glob.sync('./test/src/**/test-*.js'),
    debug: true
}));

var mainBundler = browserify(assign({}, watchify.args, {
    entries: './src/clientContextFactory.js',
    standalone: 'dolphin',
    debug: true
}));

function rebundleTest(bundler) {
    return bundler
        .transform('babelify')
        .bundle()
        .on('error', function (err) {
            $.util.log.bind($.util, 'Browserify Error: ' + err.toString());
            process.exit(1)
        })
        .pipe(source('test-bundle.js'))
        .pipe(buffer())
        .pipe($.sourcemaps.init({loadMaps: true}))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest('./test/build'))
}

function rebundle(bundler) {
    return bundler
        .transform('babelify')
        .bundle()
        .on('error', function (err) {
            $.util.log.bind($.util, 'Browserify Error: ' + err.toString());
            process.exit(1)
        })
        .pipe(source('dolphin-platform.js'))
        .pipe($.derequire())
        .pipe(gulp.dest('./dist'))
        .pipe(buffer())
        .pipe($.rename({extname: '.min.js'}))
        .pipe($.sourcemaps.init({loadMaps: true}))
        .pipe($.uglify())
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest('./dist'));
}

function createSauceLabsTestStep(customLaunchers, browsers, done) {
    return function () {
        new Server({
                configFile: __dirname + '/karma.conf.js',
                customLaunchers: customLaunchers,
                browsers: browsers,
                reporters: ['saucelabs'],
                singleRun: true
            }
            , function (result) {
                if (result === 0) {
                    done();
                } else {
                    done('Karma test failed on Saucelabs: ' + result);
                    process.exit(1)
                }
            }).start();
    }
}

function createSauceLabsTestPipe(customLaunchers, step) {
    // We cannot run too many instances at Sauce Labs in parallel, thus we need to run it several times
    // with only a few environments set
    var numSauceLabsVMs = 5;
    var allBrowsers = Object.keys(customLaunchers);

    while (allBrowsers.length > 0) {
        var browsers = [];
        for (var i = 0; i < numSauceLabsVMs && allBrowsers.length > 0; i++) {
            browsers.push(allBrowsers.shift());
        }

        step = createSauceLabsTestStep(customLaunchers, browsers, step);
    }

    step();
}

gulp.task('clean', function () {
    del(['dist', 'test/build', 'coverage']);
});

gulp.task('lint', function () {
    return gulp.src(['./src/**/*.js'])
        .pipe($.eslint())
        .pipe($.eslint.format())
        .pipe($.eslint.failAfterError());
});

gulp.task('build_impl', function () {
    return rebundle(mainBundler);
});

gulp.task('build-test', ['build_impl'], function () {
    return rebundleTest(testBundler);
});

gulp.task('test', ['build-test'], function (done) {
    new Server({
            configFile: __dirname + '/karma.conf.js',
            reporters: ['coverage', 'progress', 'dots'],
            coverageReporter: {
                reporters: [
                    {type: 'lcovonly', subdir: '.'},
                    {type: 'html', subdir: 'report-html'},
                ]
            },
            singleRun: true
        },
        function (result) {
            if (result === 0) {
                done();
            } else {
                done('Karma test failed for dolphin-platform: ' + result);
                process.exit(1)
            }
        }).start();
});

gulp.task('verify', ['lint', 'test']);

gulp.task('build', ['verify', 'build_impl'], function () {
    return rebundle(mainBundler);
});

gulp.task('watch', ['build'], function () {
    gulp.watch(['src/**', 'test/**'], ['test']);

    var watchedMainBundler = watchify(mainBundler);
    watchedMainBundler.on('update', function () {
        rebundle(watchedMainBundler)
    });

    var watchedTestBundler = watchify(testBundler);
    watchedTestBundler.on('update', function () {
        rebundleTest(watchedTestBundler)
    });
});

gulp.task('default', ['watch']);

gulp.task('saucelabs', ['build'], function (done) {
    var customLaunchers = require('./sauce.launchers.js').browsers;
    return createSauceLabsTestPipe(customLaunchers, done);
});
