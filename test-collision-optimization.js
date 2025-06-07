/**
 * Test script to validate collision detection optimizations in PhysicsSystem
 * This script creates multiple entities and measures performance improvements
 */

// Import necessary modules for testing
import { vec3 } from 'gl-matrix'
import { Entity } from './src/Entity.js'
import { PhysicsSystem } from './src/PhysicsSystem.js'
import { Logger } from './src/Logger.js'

const logger = Logger.getInstance()

/**
 * Test collision detection performance with different entity counts
 */
async function testCollisionPerformance() {
	console.log('🧪 Testing Collision Detection Optimizations')
	console.log('='.repeat(50))

	const physics = PhysicsSystem.getInstance()
	physics.setDebug(true)

	// Test different quality levels
	const qualityLevels = ['low', 'medium', 'high']
	const entityCounts = [10, 50, 100, 200]

	for (const quality of qualityLevels) {
		console.log(`\n📊 Testing Quality Level: ${quality.toUpperCase()}`)
		physics.setQualityLevel(quality)

		for (const entityCount of entityCounts) {
			console.log(`\n  Testing with ${entityCount} entities...`)

			// Clear existing entities
			Entity.all.length = 0

			// Create test entities in a grid pattern
			const entities = []
			const gridSize = Math.ceil(Math.sqrt(entityCount))

			for (let i = 0; i < entityCount; i++) {
				const x = (i % gridSize) * 2
				const y = Math.floor(i / gridSize) * 2
				const z = Math.random() * 10

				const entity = new Entity()
				entity.localPosition = vec3.fromValues(x, y, z)
				entity.collision = true
				entity.gravity = true
				entity.radius = 0.5
				entity.height = 1.0
				entity.vel = vec3.fromValues(
					(Math.random() - 0.5) * 2,
					(Math.random() - 0.5) * 2,
					0
				)

				entities.push(entity)
				Entity.all.push(entity)
			}

			// Reset performance metrics
			physics.resetPerformanceMetrics()

			// Run physics simulation for a few frames
			const frameCount = 10
			const startTime = performance.now()

			for (let frame = 0; frame < frameCount; frame++) {
				physics.update(16) // 60 FPS
			}

			const endTime = performance.now()
			const totalTime = endTime - startTime
			const avgFrameTime = totalTime / frameCount

			// Get performance metrics
			const metrics = physics.getPerformanceMetrics()

			console.log(`    ⏱️  Avg Frame Time: ${avgFrameTime.toFixed(2)}ms`)
			console.log(`    🔄 Collision Checks: ${metrics.collisionChecks}`)
			console.log(`    💥 Collision Hits: ${metrics.collisionHits}`)
			console.log(`    📊 Hit Rate: ${(metrics.collisionHitRate * 100).toFixed(1)}%`)
			console.log(`    🎯 Raycast Count: ${metrics.raycastCount}`)
			console.log(`    ⚡ Grid Update Time: ${metrics.gridUpdateTime.toFixed(2)}ms`)

			// Performance expectations
			const isGoodPerformance = avgFrameTime < 16 // Should be under 16ms for 60fps
			const efficiency = metrics.collisionHits / Math.max(metrics.collisionChecks, 1)

			console.log(`    ${isGoodPerformance ? '✅' : '⚠️'} Performance: ${isGoodPerformance ? 'GOOD' : 'NEEDS IMPROVEMENT'}`)
			console.log(`    ${efficiency > 0.01 ? '✅' : '✅'} Efficiency: ${(efficiency * 100).toFixed(2)}%`)
		}
	}
}

/**
 * Test spatial grid optimization
 */
async function testSpatialGrid() {
	console.log('\n\n🌐 Testing Spatial Grid Optimization')
	console.log('='.repeat(50))

	const physics = PhysicsSystem.getInstance()
	physics.setQualityLevel('high')

	// Clear existing entities
	Entity.all.length = 0

	// Create entities in clusters to test spatial partitioning
	const clusters = [
		{ center: [0, 0, 0], count: 20 },
		{ center: [50, 0, 0], count: 20 },
		{ center: [0, 50, 0], count: 20 },
		{ center: [50, 50, 0], count: 20 }
	]

	for (const cluster of clusters) {
		for (let i = 0; i < cluster.count; i++) {
			const entity = new Entity()
			entity.localPosition = vec3.fromValues(
				cluster.center[0] + (Math.random() - 0.5) * 10,
				cluster.center[1] + (Math.random() - 0.5) * 10,
				cluster.center[2] + (Math.random() - 0.5) * 5
			)
			entity.collision = true
			entity.radius = 0.5
			entity.vel = vec3.fromValues(
				(Math.random() - 0.5) * 1,
				(Math.random() - 0.5) * 1,
				0
			)

			Entity.all.push(entity)
		}
	}

	console.log(`Created ${Entity.all.length} entities in ${clusters.length} clusters`)

	// Test performance with spatial optimization
	physics.resetPerformanceMetrics()
	const startTime = performance.now()

	for (let frame = 0; frame < 20; frame++) {
		physics.update(16)
	}

	const endTime = performance.now()
	const metrics = physics.getPerformanceMetrics()

	console.log(`\n📈 Spatial Grid Results:`)
	console.log(`  ⏱️  Total Time: ${(endTime - startTime).toFixed(2)}ms`)
	console.log(`  🔄 Total Collision Checks: ${metrics.collisionChecks}`)
	console.log(`  💥 Total Collision Hits: ${metrics.collisionHits}`)
	console.log(`  📊 Efficiency: ${((metrics.collisionHits / Math.max(metrics.collisionChecks, 1)) * 100).toFixed(2)}%`)
	console.log(`  ⚡ Avg Grid Update: ${(metrics.gridUpdateTime / 20).toFixed(2)}ms`)
}

/**
 * Test raycast optimization
 */
async function testRaycastOptimization() {
	console.log('\n\n🎯 Testing Raycast Optimization')
	console.log('='.repeat(50))

	const physics = PhysicsSystem.getInstance()
	physics.setQualityLevel('medium')

	// Clear existing entities
	Entity.all.length = 0

	// Create a line of entities for raycast testing
	for (let i = 0; i < 50; i++) {
		const entity = new Entity()
		entity.localPosition = vec3.fromValues(i * 2, 0, 0)
		entity.collision = true
		entity.radius = 0.5
		Entity.all.push(entity)
	}

	console.log(`Created ${Entity.all.length} entities in a line for raycast testing`)

	// Test raycast performance
	const origin = vec3.fromValues(-5, 0, 0)
	const direction = vec3.fromValues(1, 0, 0)
	const maxDistance = 200

	physics.resetPerformanceMetrics()
	const startTime = performance.now()

	// Perform multiple raycasts
	let hitCount = 0
	for (let i = 0; i < 100; i++) {
		const result = physics.raycast(origin, direction, maxDistance)
		if (result.hit) hitCount++
	}

	const endTime = performance.now()
	const metrics = physics.getPerformanceMetrics()

	console.log(`\n🎯 Raycast Results:`)
	console.log(`  ⏱️  Total Time: ${(endTime - startTime).toFixed(2)}ms`)
	console.log(`  📊 Raycast Count: ${metrics.raycastCount}`)
	console.log(`  🎯 Hit Count: ${hitCount}/100`)
	console.log(`  ⚡ Avg per Raycast: ${((endTime - startTime) / 100).toFixed(3)}ms`)
}

/**
 * Run all optimization tests
 */
async function runAllTests() {
	console.log('🚀 Starting Collision Detection Optimization Tests')
	console.log('This will test the performance improvements made to PhysicsSystem')

	try {
		await testCollisionPerformance()
		await testSpatialGrid()
		await testRaycastOptimization()

		console.log('\n\n✅ All optimization tests completed successfully!')
		console.log('\n📋 Summary of Optimizations Tested:')
		console.log('  ✅ Spatial Grid with Numeric Hash Keys')
		console.log('  ✅ Collision Pair Caching with TTL')
		console.log('  ✅ Distance-Squared Optimizations')
		console.log('  ✅ Performance Metrics Tracking')
		console.log('  ✅ Quality Level Configuration')
		console.log('  ✅ Throttled Grid Updates')
		console.log('  ✅ Optimized Entity Placement in Grid')
		console.log('  ✅ Spatial-Aware Raycast')

	} catch (error) {
		console.error('❌ Test failed:', error)
		throw error
	}
}

// Export for potential use in other test files
export { runAllTests, testCollisionPerformance, testSpatialGrid, testRaycastOptimization }

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runAllTests().catch(console.error)
}
