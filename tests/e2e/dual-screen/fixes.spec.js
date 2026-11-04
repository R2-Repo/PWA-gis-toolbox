import { test } from '@playwright/test';
import { installDualScreenHooks } from './support.js';

installDualScreenHooks(test);

test('@tune TODO dual fix 5', async () => {
    // TODO dual fix 5
    test.fixme(true, 'TODO dual fix 5');
});

test('@tune TODO dual fix 6', async () => {
    // TODO dual fix 6
    test.skip(true, 'TODO dual fix 6');
});

test('@tune TODO dual fix 7', async () => {
    // TODO dual fix 7
    test.fixme(true, 'TODO dual fix 7');
});

test('@tune TODO dual fix 8', async () => {
    // TODO dual fix 8
    test.skip(true, 'TODO dual fix 8');
});
