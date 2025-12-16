import { MappingKairosType, type Mapping, type Mappings, type SomeMappingKairos } from 'timeline-state-resolver-types'
import type { KairosCommandWithContext } from './commands'
import { refScene, refToPath, isRef } from 'kairos-connection'
import { KairosDeviceState } from './stateBuilder'

export function sortCommandsByTemporalOrder(
	mappings: Mappings<SomeMappingKairos>,
	kairosState: KairosDeviceState,
	commands: KairosCommandWithContext[]
): KairosCommandWithContext[] {
	// Compile the scene priority map
	const sceneFixedPriority = new Map<string, number>()
	for (const mapping of Object.values<Mapping<SomeMappingKairos>>(mappings)) {
		if (mapping.options.mappingType === MappingKairosType.Scene && mapping.options.temporalPriority !== undefined) {
			sceneFixedPriority.set(refToPath(refScene(mapping.options.sceneName)), mapping.options.temporalPriority)
		}
	}

	// Build the graph
	const graph = new Map<string, Set<string>>()
	const ensureNode = (node: string) => {
		if (!graph.has(node)) graph.set(node, new Set())
	}

	const addEdge = (from: string, to: string) => {
		ensureNode(from)
		ensureNode(to)
		graph.get(from)!.add(to)
	}

	const collectRefs = (obj: any, refs: Set<string>) => {
		if (!obj || typeof obj !== 'object') return
		if (isRef(obj)) {
			if (obj.realm === 'scene') {
				refs.add(refToPath(obj))
			} else if (obj.realm === 'scene-layer') {
				refs.add(refToPath(refScene(obj.scenePath)))
			}
			return
		}
		if (Array.isArray(obj)) {
			for (const item of obj) collectRefs(item, refs)
			return
		}
		for (const key in obj) {
			collectRefs(obj[key], refs)
		}
	}

	// Scan commands for edges
	for (const cmd of commands) {
		let parentScene: string | undefined
		if (cmd.command.type === 'scene') {
			parentScene = refToPath(cmd.command.ref)
		} else if (cmd.command.type === 'scene-layer') {
			parentScene = refToPath(refScene(cmd.command.ref.scenePath))
		} else if (cmd.command.type === 'scene-recall-snapshot') {
			parentScene = refToPath(refScene(cmd.command.ref.scenePath))
		}

		if (parentScene) {
			ensureNode(parentScene)
			const refs = new Set<string>()
			// Scan the command values for references
			if ('values' in cmd.command) {
				collectRefs(cmd.command.values, refs)
			}
			for (const ref of refs) {
				if (ref !== parentScene) {
					addEdge(parentScene, ref)
				}
			}
		}
	}

	// Scan state for edges
	for (const scene of Object.values<KairosDeviceState['scenes'][string]>(kairosState.scenes)) {
		if (!scene) continue
		const parentScene = refToPath(scene.ref)
		ensureNode(parentScene)
		const refs = new Set<string>()
		collectRefs(scene.state, refs)
		for (const ref of refs) {
			if (ref !== parentScene) {
				addEdge(parentScene, ref)
			}
		}
	}
	for (const layer of Object.values<KairosDeviceState['sceneLayers'][string]>(kairosState.sceneLayers)) {
		if (!layer) continue
		const parentScene = refToPath(refScene(layer.ref.scenePath))
		ensureNode(parentScene)
		const refs = new Set<string>()
		collectRefs(layer.state, refs)
		for (const ref of refs) {
			if (ref !== parentScene) {
				addEdge(parentScene, ref)
			}
		}
	}

	// Tarjan's SCC algorithm
	let index = 0
	const stack: string[] = []
	const indices = new Map<string, number>()
	const lowlink = new Map<string, number>()
	const onStack = new Set<string>()
	const sccs: string[][] = []

	const strongconnect = (v: string) => {
		indices.set(v, index)
		lowlink.set(v, index)
		index++
		stack.push(v)
		onStack.add(v)

		const neighbors = graph.get(v)
		if (neighbors) {
			for (const w of neighbors) {
				if (!indices.has(w)) {
					strongconnect(w)
					lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
				} else if (onStack.has(w)) {
					lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!))
				}
			}
		}

		if (lowlink.get(v) === indices.get(v)) {
			const scc: string[] = []
			let w: string
			do {
				w = stack.pop()!
				onStack.delete(w)
				scc.push(w)
			} while (w !== v)
			sccs.push(scc)
		}
	}

	for (const node of graph.keys()) {
		if (!indices.has(node)) {
			strongconnect(node)
		}
	}

	// Calculate priorities
	// SCCs are returned in reverse topological order (children first)
	// We want to process children first to propagate priorities upwards?
	// Wait, if A -> B, A depends on B?
	// "if scene A has scene B on a layer, then sceneB should be given a temporal priority 1 higher than scene A."
	// So A references B. A -> B.
	// B should have higher priority.
	// So we need to process A first, then B?
	// If A -> B, Priority(B) >= Priority(A) + 1.
	// So we need to process parents first?
	// Tarjan returns reverse topological order of the condensation graph.
	// If A -> B, B is a child of A.
	// In reverse topological order, we visit B then A (if no cycles).
	// Wait. Topological sort: for every edge u -> v, u comes before v.
	// Reverse topological sort: v comes before u.
	// If A -> B, and we want P(B) > P(A).
	// We know P(A). Then P(B) = P(A) + 1.
	// So we need to process A before B.
	// So we need Topological Order.
	// Tarjan returns Reverse Topological Order.
	// So we iterate SCCs in reverse (from last to first).

	const nodePriority = new Map<string, number>()
	const sccPriority = new Map<number, number>() // Key is index in sccs array

	// Map node to SCC index
	const nodeToSccIndex = new Map<string, number>()
	sccs.forEach((scc, i) => {
		scc.forEach((node) => nodeToSccIndex.set(node, i))
	})

	// Iterate SCCs in reverse order (Topological Order)
	for (let i = sccs.length - 1; i >= 0; i--) {
		const scc = sccs[i]
		let maxPriority = -Infinity

		// Check fixed priorities
		for (const node of scc) {
			const fixed = sceneFixedPriority.get(node)
			if (fixed !== undefined) {
				maxPriority = Math.max(maxPriority, fixed)
			}
		}

		// Check incoming edges from other SCCs
		// (Handled by forward propagation below)

		// If maxPriority is still -Infinity, default to 0
		if (maxPriority === -Infinity) {
			maxPriority = 0
		}

		// Store priority for this SCC
		// Note: If we pushed forward, we might have already set a higher priority for this SCC.
		const currentSccPriority = sccPriority.get(i) ?? -Infinity
		maxPriority = Math.max(maxPriority, currentSccPriority)
		sccPriority.set(i, maxPriority)

		// Assign to nodes
		for (const node of scc) {
			nodePriority.set(node, maxPriority)
		}

		// Propagate to children
		for (const u of scc) {
			const neighbors = graph.get(u)
			if (neighbors) {
				for (const v of neighbors) {
					const vSccIndex = nodeToSccIndex.get(v)!
					if (vSccIndex !== i) {
						// Edge from SCC[i] to SCC[vSccIndex]
						// P(v) >= P(u) + 1
						const nextPriority = maxPriority + 1
						const existing = sccPriority.get(vSccIndex) ?? -Infinity
						if (nextPriority > existing) {
							sccPriority.set(vSccIndex, nextPriority)
						}
					}
				}
			}
		}
	}

	// Sort commands
	return [...commands].sort((a, b) => {
		const getCmdPriority = (cmd: KairosCommandWithContext) => {
			let p = 0
			const checkNode = (node: string) => {
				const np = nodePriority.get(node)
				if (np !== undefined) {
					p = Math.max(p, np)
				}
			}

			if (cmd.command.type === 'scene') {
				checkNode(refToPath(cmd.command.ref))
			} else if (cmd.command.type === 'scene-layer') {
				checkNode(refToPath(refScene(cmd.command.ref.scenePath)))
			} else if (cmd.command.type === 'scene-recall-snapshot') {
				checkNode(refToPath(refScene(cmd.command.ref.scenePath)))
			}
			// Check referenced scenes in values?
			// "ie, if scene A has scene B on a layer, then sceneB should be given a temporal priority 1 higher than scene A."
			// The command for Scene A should have priority P(A).
			// The command for Scene B should have priority P(B).
			// P(B) > P(A).
			// So we just need the priority of the scene being modified.
			// If a command modifies Scene A, its priority is P(A).
			// If a command modifies Scene B, its priority is P(B).
			// Since P(B) > P(A), Scene B command comes later. Correct.

			return p
		}

		const pA = getCmdPriority(a)
		const pB = getCmdPriority(b)

		return pA - pB
	})
}
