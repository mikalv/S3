import async from 'async';
import assert from 'assert';

import bucketPut from '../../../lib/api/bucketPut';
import bucketPutVersioning from '../../../lib/api/bucketPutVersioning';
import objectPut from '../../../lib/api/objectPut';
import objectCopy from '../../../lib/api/objectCopy';
import { ds } from '../../../lib/data/in_memory/backend';
import DummyRequest from '../DummyRequest';
import { cleanup, DummyRequestLogger, makeAuthInfo } from '../helpers';

const log = new DummyRequestLogger();
const canonicalID = 'accessKey1';
const authInfo = makeAuthInfo(canonicalID);
const namespace = 'default';
const destBucketName = 'destbucketname';
const sourceBucketName = 'sourcebucketname';
const objectKey = 'objectName';

function _createBucketPutRequest(bucketName) {
    return new DummyRequest({
        bucketName,
        namespace,
        headers: { host: `${bucketName}.s3.amazonaws.com` },
        url: '/',
    });
}
function _createBucketPutVersioningReq(status) {
    const request = {
        bucketName: destBucketName,
        headers: {
            host: `${destBucketName}.s3.amazonaws.com`,
        },
        url: '/?versioning',
        query: { versioning: '' },
    };
    const xml = '<VersioningConfiguration ' +
    'xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    `<Status>${status}</Status>` +
    '</VersioningConfiguration>';
    request.post = xml;
    return request;
}

function _createPutObjectRequest(bucketName, body) {
    const params = {
        bucketName,
        namespace,
        objectKey,
        headers: {},
        url: `/${bucketName}/${objectKey}`,
    };
    return new DummyRequest(params, body);
}
function _createObjectCopyRequest(destBucketName) {
    const params = {
        bucketName: destBucketName,
        namespace,
        objectKey,
        headers: {},
        url: `/${destBucketName}/${objectKey}`,
    };
    return new DummyRequest(params);
}

const putDestBucketRequest = _createBucketPutRequest(destBucketName);
const putSourceBucketRequest = _createBucketPutRequest(sourceBucketName);
const enableVersioningRequest = _createBucketPutVersioningReq('Enabled');
const suspendVersioningRequest = _createBucketPutVersioningReq('Suspended');

describe.only('objectCopy with versioning', () => {
    const objData = ['foo0', 'foo1', 'foo2'].map(str =>
        Buffer.from(str, 'utf8'));

    const testPutObjectRequests = objData.slice(0, 2).map(data =>
        _createPutObjectRequest(destBucketName, data));
    testPutObjectRequests.push(_createPutObjectRequest(sourceBucketName,
        objData[2]));

    function _assertDataStoreValues(expectedValues) {
        assert.strictEqual(ds.length, expectedValues.length + 1);
        for (let i = 0, j = 1; i < expectedValues.length; i++, j++) {
            if (expectedValues[i] === undefined) {
                assert.strictEqual(ds[j], expectedValues[i]);
            } else {
                assert.deepStrictEqual(ds[j].value, expectedValues[i]);
            }
        }
    }

    before(done => {
        cleanup();
        async.series([
            callback => bucketPut(authInfo, putDestBucketRequest, log,
                callback),
            callback => bucketPut(authInfo, putSourceBucketRequest, log,
                callback),
            // putting null version: put obj before versioning configured
            // in dest bucket
            callback => objectPut(authInfo, testPutObjectRequests[0],
                undefined, log, callback),
            callback => bucketPutVersioning(authInfo,
                enableVersioningRequest, log, callback),
            // put another version in dest bucket:
            callback => objectPut(authInfo, testPutObjectRequests[1],
                undefined, log, callback),
            callback => bucketPutVersioning(authInfo,
                suspendVersioningRequest, log, callback),
            // put source object in source bucket
            callback => objectPut(authInfo, testPutObjectRequests[2],
                undefined, log, callback),
        ], err => {
            if (err) {
                return done(err);
            }
            _assertDataStoreValues(objData);
            return done();
        });
    });

    after(done => {
        cleanup();
        done();
    });

    it('should delete null version when creating new null version, ' +
    'even when null version is not the latest version', done => {
        const expectedValues = objData.slice();
        // will have another copy of last object put in data after objectCopy
        expectedValues.push(objData[2]);
        const testObjectCopyRequest = _createObjectCopyRequest(destBucketName);
        objectCopy(authInfo, testObjectCopyRequest, sourceBucketName, objectKey,
            undefined, log, err => {
                assert.strictEqual(err, null, `Unexpected err: ${err}`);
                // old null version should be deleted after putting
                // new null version
                expectedValues[0] = undefined;
                process.nextTick(() => {
                    _assertDataStoreValues(expectedValues);
                    done(err);
                });
            });
    });
});
