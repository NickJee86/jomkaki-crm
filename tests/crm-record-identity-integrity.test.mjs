import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendObject,
  appendRowValues,
  buildRecordUpdateData,
  identityLookup,
  resolveUniqueRecordRow,
  scopedRecordPermitted,
  scopeData,
  uniqueSheetHeaderPosition,
  updateObject
} from '../api/crm.js';

test('generic updates reject a blank record ID before any external access', async () => {
  await assert.rejects(
    updateObject({}, 'Applications', 'Application ID', '   ', { 'Updated At': 'never' }, 'A'),
    /Application ID is required/
  );
});

test('record row resolution rejects every duplicate identifier header before selecting a row', () => {
  const rows = [
    ['\uFEFFApplication ID ', 'Applicant Name', 'Application ID'],
    ['', 'Customer One', 'APP-1'],
    ['APP-2', 'Customer Two', '']
  ];

  assert.throws(
    () => resolveUniqueRecordRow(rows, 'Application ID', 'APP-1'),
    /Ambiguous Application ID header/
  );
});

test('identified sheet appends require one identity header and a nonblank identity value', async () => {
  await assert.rejects(
    appendObject({}, 'Applications', { 'Application ID': '   ', 'Applicant Name': 'Customer One' }),
    /Missing Application ID value/
  );
  assert.throws(
    () => appendRowValues(['Applicant Name'], 'Applications', { 'Application ID': 'APP-1', 'Applicant Name': 'Customer One' }),
    /Missing Application ID header/
  );
  assert.throws(
    () => appendRowValues(['Application ID', 'Application ID'], 'Applications', { 'Application ID': 'APP-1' }),
    /Ambiguous Application ID header/
  );
  assert.deepEqual(
    appendRowValues(['\uFEFFApplication ID ', 'Applicant Name'], 'Applications', { 'Application ID': 'APP-1', 'Applicant Name': 'Customer One' }),
    ['APP-1', 'Customer One']
  );
});

test('generic updates reject identifier mutation before any external access', async () => {
  await assert.rejects(
    updateObject({}, 'Applications', 'Application ID', 'APP-1', { 'Application ID': 'APP-2', 'Updated At': 'never' }, 'A'),
    /Cannot change Application ID/
  );
});

test('generic updates reject an ambiguous destination header', () => {
  assert.throws(
    () => buildRecordUpdateData(['Application ID', 'Updated At', ' Updated At '], 'Applications', 1, { 'Updated At': 'now' }),
    /Ambiguous Updated At header/
  );
  assert.equal(uniqueSheetHeaderPosition(['Application ID'], ' Application ID ', 'Applications'), 0);
});

test('record row resolution rejects a duplicated target ID across rows', () => {
  const rows = [
    ['Application ID', 'Applicant Name'],
    ['APP-1', 'Customer One'],
    ['APP-1', 'Customer Two']
  ];

  assert.throws(
    () => resolveUniqueRecordRow(rows, 'Application ID', 'APP-1'),
    /Application ID APP-1 is duplicated/
  );
});

test('scope identity sets never authorize blank lead or application IDs', () => {
  const leads = [
    { 'Lead ID': '', 'Assigned SA ID': 'SA-1', 'Business Unit': 'MOTOR' },
    { 'Lead ID': ' LEAD-1 ', 'Assigned SA ID': 'SA-1', 'Business Unit': 'MOTOR' }
  ];
  const applications = [
    { 'Application ID': '', 'Lead ID': '', 'Assigned SA ID': 'SA-1', 'Business Unit': 'MOTOR' },
    { 'Application ID': ' APP-1 ', 'Lead ID': ' LEAD-1 ', 'Assigned SA ID': 'SA-OTHER', 'Business Unit': 'MOTOR' }
  ];

  for (const scope of [
    scopeData({ role: 'ADMIN' }, leads, applications, []),
    scopeData({ role: 'STAFF', saId: 'SA-1', businessAccess: 'BOTH' }, leads, applications, [])
  ]) {
    assert.equal(scope.leadIds.has(''), false);
    assert.equal(scope.applicationIds.has(''), false);
    assert.equal(scope.leadIds.has('LEAD-1'), true);
    assert.equal(scope.applicationIds.has('APP-1'), true);
    assert.equal(scopedRecordPermitted(scope, { 'Lead ID': '' }), false);
    assert.equal(scopedRecordPermitted(scope, { 'Application ID': '' }), false);
  }
});

test('identity lookups ignore blank keys and normalize keys before inbox ownership mapping', () => {
  const lookup = identityLookup([
    { 'Application ID': '', 'Assigned SA ID': 'SA-WRONG' },
    { 'Application ID': ' APP-1 ', 'Assigned SA ID': 'SA-RIGHT' }
  ], 'Application ID', 'Assigned SA ID');

  assert.equal(Object.hasOwn(lookup, ''), false);
  assert.equal(lookup['APP-1'], 'SA-RIGHT');
});
