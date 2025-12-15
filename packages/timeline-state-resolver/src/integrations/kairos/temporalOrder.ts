import { MappingKairosType, type Mapping, type Mappings, type SomeMappingKairos } from 'timeline-state-resolver-types'
import type { KairosCommandWithContext } from './commands'
import { protocolEncodePath } from 'kairos-connection'
import { KairosDeviceState } from './stateBuilder'

export function sortCommandsByTemporalOrder(
	mappings: Mappings<SomeMappingKairos>,
	_kairosState: KairosDeviceState,
	commands: KairosCommandWithContext[]
): KairosCommandWithContext[] {
	// Compile the scene priority map
	const scenePriority = new Map<string, number>()
	for (const mapping of Object.values<Mapping<SomeMappingKairos>>(mappings)) {
		if (mapping.options.mappingType === MappingKairosType.Scene && mapping.options.temporalPriority !== undefined) {
			scenePriority.set(protocolEncodePath(mapping.options.sceneName), mapping.options.temporalPriority ?? 0)
		}
	}

	// TODO

	return commands
}
