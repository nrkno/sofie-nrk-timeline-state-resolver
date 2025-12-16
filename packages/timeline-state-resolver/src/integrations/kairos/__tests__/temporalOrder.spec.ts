import { DeviceType, MappingKairosType, Mappings, SomeMappingKairos } from 'timeline-state-resolver-types'
import { sortCommandsByTemporalOrder } from '../temporalOrder'
import { KairosDeviceState } from '../stateBuilder'
import { KairosCommandWithContext } from '../commands'
import { refScene, refSceneLayer, refToPath } from 'kairos-connection'

const EMPTY_STATE: KairosDeviceState = {
	stateTime: 0,
	scenes: {},
	sceneSnapshots: {},
	sceneLayers: {},
	aux: {},
	macros: {},
	clipPlayers: {},
	ramRecPlayers: {},
	imageStores: {},
	soundPlayers: {},
}

function makeCommand(
	type: 'scene' | 'scene-layer',
	scene: string,
	layer?: string,
	values: any = {}
): KairosCommandWithContext {
	if (type === 'scene') {
		return {
			command: {
				type: 'scene',
				ref: refScene([scene]),
				values: values,
			},
			context: '',
			timelineObjId: '',
		}
	} else {
		return {
			command: {
				type: 'scene-layer',
				ref: refSceneLayer(refScene([scene]), [layer!]),
				sceneLayerId: refToPath(refSceneLayer(refScene([scene]), [layer!])),
				values: values,
			},
			context: '',
			timelineObjId: '',
		}
	}
}

describe('temporalOrder', () => {
	test('Simple dependency', () => {
		const mappings: Mappings<SomeMappingKairos> = {}
		const commands: KairosCommandWithContext[] = [
			makeCommand('scene', 'B'),
			makeCommand('scene', 'A', undefined, {
				// A references B
				someRef: refScene(['B']),
			}),
		]

		const sorted = sortCommandsByTemporalOrder(mappings, EMPTY_STATE, commands)

		// A references B. P(B) >= P(A) + 1.
		// So A comes first, then B.
		expect(sorted[0].command).toMatchObject({ ref: { scenePath: ['A'] } })
		expect(sorted[1].command).toMatchObject({ ref: { scenePath: ['B'] } })
	})

	test('Fixed priority', () => {
		const mappings: Mappings<SomeMappingKairos> = {
			sceneA: {
				device: DeviceType.KAIROS,
				deviceId: 'k',
				options: {
					mappingType: MappingKairosType.Scene,
					sceneName: ['A'],
					temporalPriority: 10,
				},
			},
		}
		const commands: KairosCommandWithContext[] = [
			makeCommand('scene', 'B'),
			makeCommand('scene', 'A', undefined, {
				someRef: refScene(['B']),
			}),
		]
		// A is fixed 10. A -> B. P(B) >= P(A) + 1 = 11.
		// So A (10) comes before B (11).

		const sorted = sortCommandsByTemporalOrder(mappings, EMPTY_STATE, commands)
		expect(sorted[0].command).toMatchObject({ ref: { scenePath: ['A'] } })
		expect(sorted[1].command).toMatchObject({ ref: { scenePath: ['B'] } })
	})

	test('Cycle', () => {
		const mappings: Mappings<SomeMappingKairos> = {}
		const commands: KairosCommandWithContext[] = [
			makeCommand('scene', 'A', undefined, { ref: refScene(['B']) }),
			makeCommand('scene', 'B', undefined, { ref: refScene(['A']) }),
		]
		// A -> B -> A.
		// SCC {A, B}.
		// Priority should be same (0).
		// Stable sort preserves order.

		const sorted = sortCommandsByTemporalOrder(mappings, EMPTY_STATE, commands)
		expect(sorted).toHaveLength(2)
		// Order should be A, B (original order)
		expect(sorted[0].command).toMatchObject({ ref: { scenePath: ['A'] } })
		expect(sorted[1].command).toMatchObject({ ref: { scenePath: ['B'] } })
	})
})
