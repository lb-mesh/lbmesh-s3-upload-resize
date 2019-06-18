'use strict'
/**
 * @description Read the work from AWS SQS, create the resized images & upload.
 */
var debug = require('debug')('s3_upload_size');
var _ = require('lodash');
var is = require('is2');
var im = require('imagemagick-stream');
var request = require('request');
var isStream = require('isstream');
var fs = require('fs');
var tmp = require('tmp');
var async = require('async');

// Make AWS use keep-alive connections.
var AWS = require('aws-sdk');
var https = require('https');
AWS.config.update({
    httpOptions: { agent: new https.Agent({keepAlive: true}) }
});

var s3 = new AWS.S3();
var defaultDestinationOpt =  {
    ACL: 'public-read',
    StorageClass: 'STANDARD',
    ContentType: 'image/jpeg'
};

var logger = console;
var destinationOpt;
var opts = [];

function initialize(){
  destinationOpt = defaultDestinationOpt;
}

/**
 * @description Initialization of stream upload to AWS s3
 * @param {Object} opts Configuration object. You can pass a differnet logger and extraOptions (See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#createMultipartUpload-property )
 */
module.exports.init = function(opts) {
    initialize();
    if (!is.obj(opts))
        return;
    if (is.obj(opts.logger) && is.func(opts.logger.error))
        logger = opts.logger;
    if (is.obj(opts.extraOptions))
        destinationOpt = _.extend({}, defaultDestinationOpt, opts.extraOptions);
};

/**
 * @description Stream upload to AWS s3
 * @param {String|Stream} srcFile A url or filename
 * @param {String} size The size for the new image on S3
 * @param {String} bucket The name of the s3 bucket
 * @param {String} s3FileName files name for destination file
 * @param {Function} cb The callback
 */
module.exports.uploadToS3 = function(srcFile, bucket, s3FileName, size, cb) {
    var err;
    //debug('srcFile',srcFile);
    // size is optional
    if (arguments.length === 4 && is.func(size)) {
        cb = size;
        size = false;
    }
    //debug('size '+size);

    // The callback is also optional
    if (!is.func(cb)) {
        //debug('Adding default callback');
        cb = function() {};
    }
    cb = _.once(cb);        // ensure cb is called only once

    // Figure out what out source is -- is it a url?
    var url = false;
    if (is.url(srcFile))
        url = srcFile;
    //debug('url',url);

    if (!is.nonEmptyStr(bucket))
        return cb(new Error('Bad bucket name: '+bucket));

    opts = _.extend({}, destinationOpt, {
        Bucket: bucket,
        Key: s3FileName
    });
    var tmpName;

    var getSrcStream = function(cb) {
        cb = _.once(cb);
        var params = { resize: false, size: size };
        params.tmpName = tmpName = tmp.tmpNameSync() + '.jpg';
        if (!url) {
            if (isStream.isReadable(srcFile)) {
                params.srcStream = srcFile;
                cb(null, params);
            } else {
                fs.stat(srcFile, function(err) {
                    if (err) {
                        //debug('Caught error');
                        cb(err);
                    }
                    params.srcStream = fs.createReadStream(srcFile);
                    //debug('Set srcStream to file stream');
                    cb(null, params);
                });
            }
        } else {
            var writeStream;
            try {
                writeStream = fs.createWriteStream(params.tmpName);
            } catch(err) {
                logger.error(err);
                return cb(err);
            }
            //debug('url: '+url);
            request.get(url)
            .on('error', function(err) {
                logger.error(err);
                return cb(err);
            })
            .on('response', function(resp) {
                if (Math.floor(resp.statusCode/100) !== 2) {
                    var err = new Error('Bad status code: '+resp.statusCode);
                    return cb(err);
                }
            })
            .pipe(writeStream);

            writeStream.on('finish', function() {
                //console.log('Checking download for '+params.tmpName);
                fs.stat(params.tmpName, function(err, stats) {
                    if (err)
                        return cb(err);
                    if (stats.size === 0 || !stats.isFile())
                        return cb(new Error('no image downloaded'));
                    try {
                        params.srcStream = fs.createReadStream(params.tmpName);
                    } catch(err) {
                        logger.error(err);
                        return cb(err);
                    }
                    //debug('Set srcStream to tmp file read stream: '+params.tmpName);
                    return cb(null, params);
                });
            })
            .on('error', function(err) {
                return cb(err);
            });
        }
    };

    var setupResize = function(params, cb) {
        //debug('In setupResize - 1');
        var srcStream = params.srcStream;
        var size = params.size;
        //debug(params);

        // exit if we are not re-sizing
        if (!is.string(size))
            return cb(null, params);
        if (!is.nonEmptyStr(size))
            return cb(new Error('Bad resize value: '+size));

        // get width and height for resize
        var parts = size.split('x');
        if (!parts || parts.length !== 2 ||
           !parts[0].match(/[0-9]+/) || !parts[1].match(/[0-9]+/)) {
            return cb(new Error('Bad size string '+size));
        }

        // Create ImageMagick resize stream
        var resize = im().resize(size).set('quiet').quality(90);
        if (!isStream.isWritable(resize)) {
            err = new Error('uploadToS3 non-writable stream for resize');
            return cb(err);
        }
        //debug('In setupResize - 2, '+size);

        // create temp file for image Magick
        params.tmpName2 = tmp.tmpNameSync() + '.jpg';
        var file;
        try {
            file = fs.createWriteStream(params.tmpName2);
        } catch(err) {
            logger.error(err);
            return cb(err);
        }
        //debug('\n+++ 1 Set w stream to file: '+params.tmpName2);
        //debug('In setupResize - 3');

        resize.on('error', function(err) {
            logger.error('resize error: '+err.message);
            cb(err);
        });
        file.once('finish', function() {
            //debug('\n---2 Set srcStream to file: '+params.tmpName2);
            params.srcStream = fs.createReadStream(params.tmpName2);
            cb(null, params);
        });
        srcStream.pipe(resize).pipe(file);
    };

    var doUpload = function(params, cb) {

        //debug('In doUpload');
        var srcStream = params.srcStream;
        if (!isStream.isReadable(srcStream)) {
            err = new Error('uploadToS3 non-readable stream for s3UpLoad');
            return cb(err);
        }
        srcStream.once('response', function(resp) {
            if (resp.statusCode !== 200) {
                return cb(new Error('Failed to download: '+resp.statusCode+
                                    ' error.'));
            }
        });
        srcStream.once('error', function(err) {
            return cb(err);
        });

        var s3_params = {
            Bucket: opts.Bucket,
            Key: opts.Key,
            Body: srcStream,
            ContentType: 'image/jpeg'
        };
        s3.upload(s3_params, function(err, data) {
            if (err)
                return cb(err);
            params.s3Url = data.Location;
            //debug('params.s3Url: '+params.s3Url);
            cb(null, params);
        });
    };

    var cleanUp = function(params, cb) {
        fs.unlink(params.tmpName, function(err) {
            if (err && err.code !== 'ENOENT')
                logger.error('cleanup: '+err.message);
            if (!is.str(params.tmpName2))
                return cb(null, params);
            fs.unlink(params.tmpName2, function(err) {
                if (err && err.code !== 'ENOENT')
                    logger.error('cleanup: '+err.message);
                return cb(null, params);
            });
        });
    };

    async.waterfall([ getSrcStream, setupResize, doUpload, cleanUp ],
        function(err, params) {
            if (err) {
                return cb(err);
            }
            cb(null, params.s3Url);
        }
    );
};
