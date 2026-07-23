import { describe, expect, it } from 'vitest';
import {
    buildMergeProposals,
    applyAcceptedMerges,
    defaultMergeDecisions,
    blankFillMergedRow
} from '../js/atlas/import/merge-proposals.js';

describe('atlas merge proposals', () => {
    it('proposes high-confidence match on exact inventory key', () => {
        const tmd = {
            inventoryName: 'Site Alpha',
            inventoryKey: 'SITE ALPHA',
            channel: 'C100',
            drop: 1,
            lat: 40.1,
            lon: -111.1
        };
        const sw = {
            inventoryName: 'Site Alpha',
            inventoryKey: 'SITE ALPHA',
            ip: '10.0.0.1',
            lat: 40.1,
            lon: -111.1
        };
        const joined = [{ tmd, switchFiber: null, matchConfidence: 'site-only' }];
        const unmatchedSwitch = [sw];
        const proposals = buildMergeProposals({ joined, unmatchedSwitch, atmsMatches: [] });
        expect(proposals.length).toBe(1);
        expect(proposals[0].confidence).toBe('high');
        const decisions = defaultMergeDecisions(proposals);
        expect(decisions[proposals[0].id]).toBe('accept');
        applyAcceptedMerges({ joined, unmatchedSwitch, decisions, proposals, atmsMatches: [] });
        expect(joined[0].switchFiber).toBe(sw);
        expect(unmatchedSwitch.length).toBe(0);
    });

    it('proposes medium confidence on near-duplicate name', () => {
        const tmd = {
            inventoryName: 'Alpha Junction Relay Site',
            inventoryKey: 'ALPHA JUNCTION RELAY SITE',
            channel: 'C300',
            drop: 4,
            lat: 41,
            lon: -112
        };
        const sw = {
            inventoryName: 'Alpha Junction',
            inventoryKey: 'ALPHA JUNCTION',
            ip: '10.0.0.9',
            lat: 45,
            lon: -118
        };
        const joined = [{ tmd, switchFiber: null, matchConfidence: 'site-only' }];
        const unmatchedSwitch = [sw];
        const proposals = buildMergeProposals({ joined, unmatchedSwitch, atmsMatches: [] });
        expect(proposals.length).toBe(1);
        expect(proposals[0].confidence).toBe('medium');
        expect(proposals[0].reason).toBe('near_duplicate_name');
    });

    it('proposes high confidence on channel+drop via ATMS IP', () => {
        const tmd = {
            inventoryName: 'Remote Tower',
            inventoryKey: 'REMOTE TOWER',
            channel: 'C500',
            drop: 7,
            lat: 42,
            lon: -113
        };
        const sw = {
            inventoryName: 'Switch at tower',
            inventoryKey: 'SWITCH AT TOWER',
            ip: '10.1.2.3',
            lat: null,
            lon: null
        };
        const atmsMatches = [{
            atms: {
                deviceType: 'SWTN',
                ip: '10.1.2.3',
                channel: 'C500',
                drop: 7,
                gateway: '10.1.2.1',
                subnet: '255.255.255.0',
                priHub: 'H01',
                secHub: null
            },
            switchFiber: null,
            matchConfidence: 'channel-drop',
            provisional: true,
            tmd
        }];
        const joined = [{ tmd, switchFiber: null, matchConfidence: 'site-only' }];
        const unmatchedSwitch = [sw];
        const proposals = buildMergeProposals({ joined, unmatchedSwitch, atmsMatches });
        expect(proposals.some((p) => p.reason === 'channel_drop_atms_ip')).toBe(true);
        const prop = proposals.find((p) => p.reason === 'channel_drop_atms_ip');
        const decisions = { [prop.id]: 'accept' };
        applyAcceptedMerges({
            joined,
            unmatchedSwitch,
            decisions,
            proposals,
            atmsMatches
        });
        expect(joined[0].switchFiber).toBe(sw);
        expect(tmd.lat).toBe(42);
        expect(sw.lat).toBe(42);
        expect(atmsMatches[0].provisional).toBe(false);
    });

    it('marks ambiguous when multiple geo candidates', () => {
        const tmd = {
            inventoryName: 'Mid Site',
            inventoryKey: 'MID SITE',
            channel: 'C200',
            drop: 2,
            lat: 40.5,
            lon: -111.5
        };
        const joined = [{ tmd, switchFiber: null, matchConfidence: 'site-only' }];
        const unmatchedSwitch = [
            { inventoryName: 'A', inventoryKey: 'A', ip: '10.0.0.2', lat: 40.5, lon: -111.5 },
            { inventoryName: 'B', inventoryKey: 'B', ip: '10.0.0.3', lat: 40.5001, lon: -111.5001 }
        ];
        const proposals = buildMergeProposals({ joined, unmatchedSwitch, atmsMatches: [] });
        expect(proposals.some((p) => p.kind === 'ambiguous')).toBe(true);
    });

    it('applies ambiguous merge when candidate is picked', () => {
        const tmd = {
            inventoryName: 'Mid Site',
            inventoryKey: 'MID SITE',
            channel: 'C200',
            drop: 2,
            lat: 40.5,
            lon: -111.5
        };
        const swA = { inventoryName: 'A', inventoryKey: 'A', ip: '10.0.0.2', lat: 40.5, lon: -111.5 };
        const swB = { inventoryName: 'B', inventoryKey: 'B', ip: '10.0.0.3', lat: 40.5001, lon: -111.5001 };
        const joined = [{ tmd, switchFiber: null, matchConfidence: 'site-only' }];
        const unmatchedSwitch = [swA, swB];
        const proposals = buildMergeProposals({ joined, unmatchedSwitch, atmsMatches: [] });
        const amb = proposals.find((p) => p.kind === 'ambiguous');
        applyAcceptedMerges({
            joined,
            unmatchedSwitch,
            decisions: { [amb.id]: 'accept' },
            candidatePicks: { [amb.id]: 'A' },
            proposals,
            atmsMatches: []
        });
        expect(joined[0].switchFiber).toBe(swA);
        expect(unmatchedSwitch).toEqual([swB]);
    });

    it('blank-fills coords from switch onto TMD', () => {
        const tmd = { inventoryName: 'X', inventoryKey: 'X', lat: null, lon: null, channel: 'C1', drop: 1 };
        const sw = { inventoryName: 'X', inventoryKey: 'X', ip: '10.0.0.5', lat: 40, lon: -111 };
        blankFillMergedRow({ tmd, switchFiber: sw }, []);
        expect(tmd.lat).toBe(40);
        expect(tmd.lon).toBe(-111);
    });
});
