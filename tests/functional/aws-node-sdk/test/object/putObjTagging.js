import assert from 'assert';
const async = require('async');

import withV4 from '../support/withV4';
import BucketUtility from '../../lib/utility/bucket-util';

const bucketName = 'testtaggingbucket';
const objectName = 'testtaggingobject';
import { taggingTests } from '../../lib/utility/tagging';

import {
    removeAllVersions,
    versioningEnabled,
} from '../../lib/utility/versioning-util';

function generateMultipleTagConfig(nbr) {
    const tags = [];
    for (let i = 0; i < nbr; i++) {
        tags.push({ Key: `myKey${i}`, Value: `myValue${i}` });
    }
    return {
        TagSet: tags,
    };
}
function generateTaggingConfig(key, value) {
    return {
        TagSet: [
            {
                Key: key,
                Value: value,
            },
        ],
    };
}

function _checkError(err, code, statusCode) {
    assert(err, 'Expected error but found none');
    assert.strictEqual(err.code, code);
    assert.strictEqual(err.statusCode, statusCode);
}

describe('PUT object taggings', () => {
    withV4(sigCfg => {
        const bucketUtil = new BucketUtility('default', sigCfg);
        const s3 = bucketUtil.s3;

        beforeEach(done => s3.createBucket({ Bucket: bucketName }, err => {
            if (err) {
                return done(err);
            }
            return s3.putObject({ Bucket: bucketName, Key: objectName }, done);
        }));

        afterEach(() => {
            process.stdout.write('Emptying bucket');
            return bucketUtil.empty(bucketName)
            .then(() => {
                process.stdout.write('Deleting bucket');
                return bucketUtil.deleteOne(bucketName);
            })
            .catch(err => {
                process.stdout.write('Error in afterEach');
                throw err;
            });
        });

        taggingTests.forEach(taggingTest => {
            it(taggingTest.it, done => {
                const taggingConfig = generateTaggingConfig(taggingTest.tag.key,
                  taggingTest.tag.value);
                s3.putObjectTagging({ Bucket: bucketName, Key: objectName,
                  Tagging: taggingConfig }, (err, data) => {
                    if (taggingTest.error) {
                        _checkError(err, taggingTest.error, 400);
                    } else {
                        assert.ifError(err, `Found unexpected err ${err}`);
                        assert.strictEqual(Object.keys(data).length, 0);
                    }
                    done();
                });
            });
        });

        it('should return BadRequest if putting more that 10 tags', done => {
            const taggingConfig = generateMultipleTagConfig(11);
            s3.putObjectTagging({ Bucket: bucketName, Key: objectName,
              Tagging: taggingConfig }, err => {
                _checkError(err, 'BadRequest', 400);
                done();
            });
        });

        it('should return InvalidTag if using the same key twice', done => {
            s3.putObjectTagging({ Bucket: bucketName, Key: objectName,
              Tagging: { TagSet: [
                  {
                      Key: 'key1',
                      Value: 'value1',
                  },
                  {
                      Key: 'key1',
                      Value: 'value2',
                  },
              ] },
          }, err => {
                _checkError(err, 'InvalidTag', 400);
                done();
            });
        });

        it('should be able to put an empty Tag set', done => {
            s3.putObjectTagging({ Bucket: bucketName, Key: objectName,
              Tagging: { TagSet: [] },
          }, (err, data) => {
                assert.ifError(err, `Found unexpected err ${err}`);
                assert.strictEqual(Object.keys(data).length, 0);
                done();
            });
        });
    });
});

describe('Put object tagging with versioning', () => {
    withV4(sigCfg => {
        const bucketUtil = new BucketUtility('default', sigCfg);
        const s3 = bucketUtil.s3;
        before(done => s3.createBucket({ Bucket: bucketName }, done));
        afterEach(done => {
            removeAllVersions({ Bucket: bucketName }, err => {
                if (err) {
                    return done(err);
                }
                return s3.deleteBucket({ Bucket: bucketName }, done);
            });
        });

        it('should be able to put tag with versioning', done => {
            async.waterfall([
                next => s3.putBucketVersioning({ Bucket: bucketName,
                  VersioningConfiguration: versioningEnabled },
                  err => next(err)),
                next => s3.putObject({ Bucket: bucketName, Key: objectName },
                  (err, data) => next(err, data.VersionId)),
                (versionId, next) => s3.putObjectTagging({
                    Bucket: bucketName,
                    Key: objectName,
                    VersionId: versionId,
                    Tagging: { TagSet: [
                        {
                            Key: 'key1',
                            Value: 'value1',
                        }] },
                }, (err, data) => next(err, data, versionId)),
            ], (err, data, versionId) => {
                assert.ifError(err, `Found unexpected err ${err}`);
                assert.strictEqual(data.VersionId, versionId);
                done();
            });
        });
    });
});
