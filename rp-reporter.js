const { reporters } = require('mocha'),
    RPClient = require('reportportal-client'),
    { testItemStatuses, logLevels } = require('./src/constants'),
    {
        promiseErrorHandler,
        getStartLaunchObject,
        getSuiteStartObject,
        getTestStartObject,
        getBase64FileObject
    } = require('./src/reporter-utilities');

const { PASSED, FAILED, SKIPPED } = testItemStatuses,
    { ERROR } = logLevels;

let runnerSuiteId = null,
    runnerTestId = null;

class ReportPortalReporter extends reporters.Base {
    constructor (runner, config) {
        super(runner);
        this.runner = runner;
        this.client = new RPClient(config.reporterOptions);
        this.testStartRequestsPromises = {};
        this.lastFailedTestRequestPromises = {};
        this.currentSuiteId = null;
        this.currentTestId = null;

        runner.on('start', () => {
            let requestObj = getStartLaunchObject(config.reporterOptions);
            const { tempId, promise } = this.client.startLaunch(requestObj);

            promiseErrorHandler(promise);
            this.tempLaunchId = tempId;
            this.parentIds = {};
        });

        runner.on('suite', suite => {
            runnerSuiteId = `suite${Date.now().toString()}`;
            suite.cid = runnerSuiteId;
            this.suiteStart(suite);
        });

        runner.on('suite end', suite => {
            suite.cid = runnerSuiteId;
            this.suiteEnd(suite);
        });

        runner.on('test', test => {
            runnerTestId = Date.now().toString();
            test.cid = runnerTestId;
            this.testStart(test);
        });

        runner.on('test pending', test => {
            test.cid = runnerTestId;
            this.testFinishedSkip(test, SKIPPED, { issue_type: 'NOT_ISSUE' });
        });

        runner.on('pass', test => {
            test.cid = runnerTestId;
            this.testFinishedPass(test);
        });

        runner.on('fail', test => {
            test.cid = runnerTestId;
            this.testFinishedFail(test);
            this.lastFailedTestRequestPromises[test.cid] = this.testStartRequestsPromises[test.cid];
        });

        runner.on('end', () => {
            this.client.finishLaunch(this.tempLaunchId);
        });

        runner.on('rp:log', (level, message) => {
            this.sendLog(level, message);
        });
    }

    getParentIds (suiteId) {
        if (this.parentIds[suiteId]) {
            return this.parentIds[suiteId];
        }

        this.parentIds[suiteId] = [];

        return this.parentIds[suiteId];
    }

    getParentId (suiteId) {
        const parentIds = this.getParentIds(suiteId);

        if (!parentIds.length) {
            return null;
        }

        return parentIds[parentIds.length - 1];
    }

    addParentId (suiteId, id) {
        const parentIds = this.getParentIds(suiteId);

        parentIds.push(id);
    }

    clearParent (suiteId) {
        const parentIds = this.getParentIds(suiteId);

        parentIds.pop();
    }

    suiteStart (suite) {
        if (!suite.title) {
            return;
        }

        const suiteStartObj = getSuiteStartObject(suite);

        this.currentSuiteId = suite.cid;

        const { tempId, promise } = this.client.startTestItem(suiteStartObj,
            this.tempLaunchId,
            this.getParentId(suite.cid));

        promiseErrorHandler(promise);
        this.addParentId(suite.cid, tempId);
        this.currentSuiteId = tempId;
    }

    suiteEnd (suite) {
        const parentId = this.getParentId(suite.cid);

        if (parentId === null) {
            return;
        }

        const { promise } = this.client.finishTestItem(parentId, {});

        promiseErrorHandler(promise);
        this.clearParent(suite.cid);
    }

    testStart (test) {
        if (!test.title) {
            return;
        }
        const testStartObj = getTestStartObject(test.title),
            { tempId, promise } = this.client.startTestItem(testStartObj, this.tempLaunchId, this.currentSuiteId); // this.getParentId(test.cid)

        promiseErrorHandler(promise);
        this.testStartRequestsPromises[test.cid] = promise;
        this.addParentId(test.cid, tempId);
        this.currentTestId = tempId;
    }

    testFinishedPass (test, issue) {
        // eslint-disable-next-line object-shorthand
        let finishTestObj = { PASSED, issue, description: test.body };

        this.testFinished(test, finishTestObj);
    }

    testFinishedSkip (test, issue) {
        let finishTestObj = { SKIPPED, issue };

        this.testFinished(test, finishTestObj);
    }

    testFinishedFail (test, issue) {
        const parentId = this.getParentId(test.cid);
        let screenShotObj = getBase64FileObject(test.title),
            message = `Stacktrace: ${test.err.stack}\n`,
            finishTestObj = {
                status: FAILED,
                issues: issue,
                description: `${test.body}\n\`\`\`error\n${message}\n\`\`\``
            };

        this.client.sendLog(parentId,
            {
                message: message,
                level: ERROR,
                time: new Date().valueOf()
            },
            screenShotObj);

        this.testFinished(test, finishTestObj);
    }

    testFinished (test, finishTestObj) {
        const parentId = this.getParentId(test.cid),
            { promise } = this.client.finishTestItem(parentId, finishTestObj);

        promiseErrorHandler(promise);

        this.clearParent(test.cid);
        delete this.testStartRequestsPromises[test.cid];
    }

    // NOTE: Check how it used
    sendLog (level, message) {
        const { promise } = this.client.sendLog(this.currentTestId, {
            message: String(message),
            level: level,
            time: new Date().valueOf() + 1
        });

        promiseErrorHandler(promise);
    }
}

module.exports = ReportPortalReporter;
