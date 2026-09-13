// utils/keyClick.test.js
// DOM-free unit tests for the Z/X-as-mouse emulation helpers. The real browser
// globals (document/PointerEvent/MouseEvent) are stubbed per-test and restored
// afterwards so no DOM is required.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isEditableTarget,
  resolveKeyAction,
  shouldFireKeyClick,
  trackPointerPosition,
  fireSingleClickAtCursor,
  fireDoubleClickAtCursor,
  setLastPointerForTest,
} from './keyClick.js';

function stubDom(hitElement, { activeElement = null } = {}) {
  const seen = [];
  const el = hitElement || {
    dispatched: seen,
    dispatchEvent(e) {
      seen.push({ type: e.type, detail: e.detail });
      return true;
    },
    closest: () => null,
  };
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  const prev = {
    document: globalThis.document,
    PointerEvent: globalThis.PointerEvent,
    MouseEvent: globalThis.MouseEvent,
    window: globalThis.window,
  };
  globalThis.document = { elementFromPoint: () => el, activeElement };
  globalThis.PointerEvent = FakeEvent;
  globalThis.MouseEvent = FakeEvent;
  globalThis.window = {};
  return {
    el,
    seen: el.dispatched ?? seen,
    restore() {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
      setLastPointerForTest(null, null);
    },
  };
}

test('isEditableTarget guards typing surfaces only', () => {
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget({}), false);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
  assert.equal(isEditableTarget({ tagName: 'button' }), false);
  assert.equal(isEditableTarget({ tagName: 'input' }), true);
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableTarget({ tagName: 'select' }), true);
  assert.equal(isEditableTarget({ tagName: 'div', isContentEditable: true }), true);
});

test('resolveKeyAction maps Z/X case-insensitively', () => {
  assert.equal(resolveKeyAction('z'), 'single');
  assert.equal(resolveKeyAction('Z'), 'single');
  assert.equal(resolveKeyAction('x'), 'double');
  assert.equal(resolveKeyAction('X'), 'double');
  assert.equal(resolveKeyAction('a'), null);
  assert.equal(resolveKeyAction(''), null);
  assert.equal(resolveKeyAction(null), null);
});

test('shouldFireKeyClick respects the toggle, modifiers, and editables', () => {
  const base = { key: 'z', target: { tagName: 'DIV' } };
  assert.equal(shouldFireKeyClick(base, true), 'single');
  assert.equal(shouldFireKeyClick({ ...base, key: 'X' }, true), 'double');
  assert.equal(shouldFireKeyClick(base, false), null);
  assert.equal(shouldFireKeyClick({ ...base, ctrlKey: true }, true), null);
  assert.equal(shouldFireKeyClick({ ...base, metaKey: true }, true), null);
  assert.equal(shouldFireKeyClick({ ...base, altKey: true }, true), null);
  assert.equal(shouldFireKeyClick({ ...base, key: 'a' }, true), null);
  assert.equal(
    shouldFireKeyClick({ ...base, target: { tagName: 'INPUT' } }, true),
    null,
  );
  assert.equal(
    shouldFireKeyClick({ ...base, target: { tagName: 'div', isContentEditable: true } }, true),
    null,
  );
});

test('trackPointerPosition records the cursor, ignoring junk', () => {
  const dom = stubDom();
  try {
    trackPointerPosition({ clientX: 100, clientY: 200 });
    assert.equal(fireSingleClickAtCursor(), true);
    assert.equal(dom.seen.length, 5);
    trackPointerPosition(null);
    trackPointerPosition({});
    // Junk events leave the last good position intact.
    assert.equal(fireSingleClickAtCursor(), true);
    assert.equal(dom.seen.length, 10);
  } finally {
    dom.restore();
  }
});

test('fireSingleClickAtCursor dispatches the full mouse sequence', () => {
  const dom = stubDom();
  try {
    // No cursor yet → no-op.
    assert.equal(fireSingleClickAtCursor(), false);
    setLastPointerForTest(100, 200);
    assert.equal(fireSingleClickAtCursor(), true);
    assert.deepEqual(
      dom.seen.map((e) => e.type),
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
    );
    assert.equal(dom.seen.at(-1).detail, 1);
  } finally {
    dom.restore();
  }
});

test('fireDoubleClickAtCursor dispatches two clicks plus dblclick', () => {
  const dom = stubDom();
  try {
    setLastPointerForTest(50, 60);
    assert.equal(fireDoubleClickAtCursor(), true);
    assert.deepEqual(
      dom.seen.map((e) => e.type),
      [
        'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
        'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
        'dblclick',
      ],
    );
    assert.equal(dom.seen.at(-1).detail, 2);
  } finally {
    dom.restore();
  }
});

test('fire functions no-op when nothing is under the cursor', () => {
  const prevDocument = globalThis.document;
  globalThis.document = { elementFromPoint: () => null };
  try {
    setLastPointerForTest(10, 10);
    assert.equal(fireSingleClickAtCursor(), false);
    assert.equal(fireDoubleClickAtCursor(), false);
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    setLastPointerForTest(null, null);
  }
});

// A focusable hit-test target (e.g. a pile container) recording focus() calls.
function focusableStub({ tabIndex = '0', disabled = false } = {}) {
  const focusCalls = [];
  const dispatched = [];
  const el = {
    dispatched,
    dispatchEvent(e) {
      dispatched.push({ type: e.type, detail: e.detail });
      return true;
    },
    closest: () => el,
    hasAttribute: (name) => name === 'disabled' && disabled,
    getAttribute: (name) => (name === 'tabindex' ? tabIndex : null),
    focus(...args) {
      focusCalls.push(args);
    },
  };
  return { el, focusCalls };
}

test('emulated clicks focus without :focus-visible indication', () => {
  const { el, focusCalls } = focusableStub();
  const dom = stubDom(el);
  try {
    setLastPointerForTest(100, 200);
    assert.equal(fireSingleClickAtCursor(), true);
    // Focus still moves (continuity for Enter/Space, card selection), but must
    // opt out of the visible ring: the Z/X keypress puts the browser in
    // keyboard modality, where a bare focus() would match `:focus-visible`
    // and repaint the pile indicator on every emulated click.
    assert.deepEqual(focusCalls, [[{ preventScroll: true, focusVisible: false }]]);
  } finally {
    dom.restore();
  }
});

test('emulated clicks skip focus for locked (tabindex -1) targets', () => {
  const { el, focusCalls } = focusableStub({ tabIndex: '-1' });
  const dom = stubDom(el);
  try {
    setLastPointerForTest(100, 200);
    assert.equal(fireSingleClickAtCursor(), true);
    assert.equal(focusCalls.length, 0);
    // The click sequence itself still fires.
    assert.deepEqual(
      dom.seen.map((e) => e.type),
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
    );
  } finally {
    dom.restore();
  }
});

test('emulated clicks skip focus when the target is already focused', () => {
  const { el, focusCalls } = focusableStub();
  const dom = stubDom(el, { activeElement: el });
  try {
    setLastPointerForTest(100, 200);
    assert.equal(fireSingleClickAtCursor(), true);
    assert.equal(focusCalls.length, 0);
  } finally {
    dom.restore();
  }
});
