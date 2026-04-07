// Table matcher: find tables from a reference binary (with A2L) in a target binary (without A2L)
//
// Strategy (6 passes):
//   1. Exact match — full table bytes
//   2. Signature match — first N bytes of table data
//   3. Context match — surrounding bytes (neighboring calibration data)
//   4. Anchor interpolation — estimate offset from nearby matched tables, verify with byte similarity
//   5. Multi-anchor consensus — multiple anchor pairs vote on position, no byte check needed
//   6. Tight-neighbor interpolation — very close matched neighbors, layout ratio ~1.0

const TYPE_SIZES = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 }

function extractBytes(data, offset, len) {
  if (offset < 0 || offset + len > data.length) return null
  return data.slice(offset, offset + len)
}

function findPattern(data, pattern, maxResults = 50) {
  const results = []
  if (!pattern || pattern.length === 0) return results
  const len = pattern.length

  outer:
  for (let i = 0; i <= data.length - len; i++) {
    for (let j = 0; j < len; j++) {
      if (data[i + j] !== pattern[j]) continue outer
    }
    results.push(i)
    if (results.length >= maxResults) break
  }
  return results
}

function byteSimilarity(data1, off1, data2, off2, len) {
  let matches = 0
  for (let i = 0; i < len; i++) {
    if (off1 + i >= data1.length || off2 + i >= data2.length) return 0
    if (data1[off1 + i] === data2[off2 + i]) matches++
  }
  return matches / len
}

function tableBytes(table) {
  return table.rows * table.cols * (TYPE_SIZES[table.dataType] || 1)
}

function interpolateOffset(table, anchors, refData, targetData) {
  const len = tableBytes(table)
  let before = null, after = null
  for (const a of anchors) {
    if (a.table.offset <= table.offset) before = a
    if (a.table.offset > table.offset && !after) after = a
  }
  if (!before || !after || before === after) return null

  const refSpan = after.table.offset - before.table.offset
  const targetSpan = after.targetOffset - before.targetOffset
  if (refSpan <= 0) return null

  const ratio = targetSpan / refSpan
  if (ratio < 0.5 || ratio > 2.0) return null

  const t = (table.offset - before.table.offset) / refSpan
  const estimated = Math.round(before.targetOffset + t * targetSpan)

  if (estimated < 0 || estimated + len > targetData.length) return null
  return estimated
}

/**
 * @param {Array} refTables - Tables with offsets for reference binary
 * @param {Uint8Array} refData - Reference binary (has A2L)
 * @param {Uint8Array} targetData - Target binary (no A2L)
 * @param {function} onProgress - Optional callback(pass, matched, total)
 * @returns {{ matches, matched, total, unmatched }}
 */
export function matchTables(refTables, refData, targetData, onProgress) {
  const results = []
  const matched = new Set()

  const report = (pass) => {
    console.log(`[matcher] pass=${pass} matched=${matched.size}/${refTables.length}`)
    onProgress?.(pass, matched.size, refTables.length)
  }

  // === PASS 1: Full exact match (small-medium tables) ===
  for (const table of refTables) {
    const len = tableBytes(table)
    if (len < 2 || len > 128) continue

    const pattern = extractBytes(refData, table.offset, len)
    if (!pattern) continue

    const hits = findPattern(targetData, pattern, 10)
    if (hits.length === 1) {
      results.push({ table, targetOffset: hits[0], confidence: 0.95, method: 'exact' })
      matched.add(table.id)
    } else if (hits.length >= 2 && hits.length <= 5) {
      // Disambiguate with relative position
      const relPos = table.offset / refData.length
      const best = hits.reduce((a, b) =>
        Math.abs(a / targetData.length - relPos) < Math.abs(b / targetData.length - relPos) ? a : b
      )
      results.push({ table, targetOffset: best, confidence: 0.7, method: 'exact-multi' })
      matched.add(table.id)
    }
  }
  report('exact')

  // === PASS 2: Progressive signature match ===
  // Try increasingly shorter signatures until we get a unique hit
  for (const table of refTables) {
    if (matched.has(table.id)) continue
    const len = tableBytes(table)
    if (len < 4) continue

    // Try signature lengths: full (capped at 128), then 64, 32, 16, 8
    const sigLengths = [Math.min(len, 128), 64, 32, 16, 8].filter(s => s <= len && s >= 8)
    // deduplicate
    const seen = new Set()
    for (const sigLen of sigLengths) {
      if (seen.has(sigLen)) continue
      seen.add(sigLen)

      const sig = extractBytes(refData, table.offset, sigLen)
      if (!sig) continue

      const hits = findPattern(targetData, sig, 10)
      if (hits.length === 1) {
        results.push({
          table,
          targetOffset: hits[0],
          confidence: sigLen >= 64 ? 0.92 : sigLen >= 32 ? 0.88 : 0.82,
          method: 'signature',
        })
        matched.add(table.id)
        break
      }
      if (hits.length === 0) break // if longer sig has no hits, shorter won't help
    }
  }
  report('signature')

  // === PASS 3: Context matching ===
  // Use bytes surrounding the table as a fingerprint
  const CTX_SIZES = [32, 24, 16, 8]

  for (const table of refTables) {
    if (matched.has(table.id)) continue
    const len = tableBytes(table)

    // Try context before the table
    for (const ctxLen of CTX_SIZES) {
      if (table.offset < ctxLen) continue
      const ctx = extractBytes(refData, table.offset - ctxLen, ctxLen)
      if (!ctx) continue

      const hits = findPattern(targetData, ctx, 5)
      if (hits.length === 1) {
        const candidate = hits[0] + ctxLen
        if (candidate + len <= targetData.length) {
          results.push({
            table,
            targetOffset: candidate,
            confidence: ctxLen >= 24 ? 0.8 : 0.7,
            method: 'context-before',
          })
          matched.add(table.id)
          break
        }
      }
    }
    if (matched.has(table.id)) continue

    // Try context after the table
    for (const ctxLen of CTX_SIZES) {
      const afterOffset = table.offset + len
      if (afterOffset + ctxLen > refData.length) continue
      const ctx = extractBytes(refData, afterOffset, ctxLen)
      if (!ctx) continue

      const hits = findPattern(targetData, ctx, 5)
      if (hits.length === 1) {
        const candidate = hits[0] - len
        if (candidate >= 0) {
          results.push({
            table,
            targetOffset: candidate,
            confidence: ctxLen >= 24 ? 0.75 : 0.65,
            method: 'context-after',
          })
          matched.add(table.id)
          break
        }
      }
    }
  }
  report('context')

  // === PASS 4: Anchor-relative matching with byte verification ===
  const anchors = results
    .filter(r => r.confidence >= 0.8)
    .sort((a, b) => a.table.offset - b.table.offset)

  if (anchors.length >= 3) {
    for (const table of refTables) {
      if (matched.has(table.id)) continue
      const len = tableBytes(table)
      if (len < 2) continue

      const estimated = interpolateOffset(table, anchors, refData, targetData)
      if (estimated == null) continue

      // Verify with byte similarity
      const checkLen = Math.min(len, 64)
      const sim = byteSimilarity(refData, table.offset, targetData, estimated, checkLen)

      if (sim >= 0.6) {
        results.push({
          table,
          targetOffset: estimated,
          confidence: Math.round(sim * 0.7 * 100) / 100,
          method: 'interpolated',
        })
        matched.add(table.id)
      }
    }
  }
  report('interpolated')

  // === PASS 5: Multi-anchor consensus (no byte verification needed) ===
  // For tables where data differs (e.g. turbo vs NA calibration), byte checks fail.
  // Instead, use multiple independent anchor pairs — if they all agree on the same
  // target offset, positional consensus alone is strong evidence.
  if (anchors.length >= 4) {
    for (const table of refTables) {
      if (matched.has(table.id)) continue
      const len = tableBytes(table)
      if (len < 2) continue

      // Collect estimates from multiple anchor pairs
      const estimates = []
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const before = anchors[i]
          const after = anchors[j]
          // Need one anchor before and one after the table
          if (before.table.offset > table.offset || after.table.offset <= table.offset) continue

          const refSpan = after.table.offset - before.table.offset
          const targetSpan = after.targetOffset - before.targetOffset
          if (refSpan <= 0) continue

          const ratio = targetSpan / refSpan
          if (ratio < 0.8 || ratio > 1.2) continue

          const t = (table.offset - before.table.offset) / refSpan
          const est = Math.round(before.targetOffset + t * targetSpan)
          if (est >= 0 && est + len <= targetData.length) {
            estimates.push(est)
          }
        }
      }

      if (estimates.length < 3) continue

      // Check consensus: do estimates cluster tightly?
      estimates.sort((a, b) => a - b)
      const median = estimates[Math.floor(estimates.length / 2)]
      const tolerance = Math.max(len, 8) // allow offset-by-size jitter
      const agreeing = estimates.filter(e => Math.abs(e - median) <= tolerance)

      if (agreeing.length >= 3 && agreeing.length >= estimates.length * 0.6) {
        // Strong positional consensus
        const consensusOffset = agreeing[Math.floor(agreeing.length / 2)]

        // Optional: check byte similarity for bonus confidence (but don't require it)
        const checkLen = Math.min(len, 64)
        const sim = byteSimilarity(refData, table.offset, targetData, consensusOffset, checkLen)
        const baseConf = Math.min(0.55 + (agreeing.length - 3) * 0.05, 0.75)

        results.push({
          table,
          targetOffset: consensusOffset,
          confidence: Math.round(Math.max(baseConf, sim * 0.7) * 100) / 100,
          method: 'consensus',
        })
        matched.add(table.id)
      }
    }
  }
  report('consensus')

  // === PASS 6: Tight-neighbor interpolation ===
  // If the two closest matched neighbors are very near, interpolation is reliable
  // even without byte or consensus verification.
  const allAnchors = results
    .filter(r => r.confidence >= 0.5)
    .sort((a, b) => a.table.offset - b.table.offset)

  if (allAnchors.length >= 2) {
    for (const table of refTables) {
      if (matched.has(table.id)) continue
      const len = tableBytes(table)
      if (len < 2) continue

      // Find immediate neighbors
      let before = null, after = null
      for (const a of allAnchors) {
        if (a.table.offset <= table.offset) before = a
        if (a.table.offset > table.offset && !after) after = a
      }
      if (!before || !after) continue

      const refSpan = after.table.offset - before.table.offset
      const targetSpan = after.targetOffset - before.targetOffset
      if (refSpan <= 0 || refSpan > 2048) continue

      const ratio = targetSpan / refSpan
      if (ratio < 0.85 || ratio > 1.15) continue

      const t = (table.offset - before.table.offset) / refSpan
      const estimated = Math.round(before.targetOffset + t * targetSpan)

      if (estimated < 0 || estimated + len > targetData.length) continue

      results.push({
        table,
        targetOffset: estimated,
        confidence: 0.55,
        method: 'neighbor',
      })
      matched.add(table.id)
    }
  }
  report('neighbor')

  // === PASS 7: Single-anchor extrapolation ===
  // Use the closest matched table + global offset delta to estimate position.
  // Low confidence but catches tables in sparse anchor regions.
  const globalAnchors = results
    .filter(r => r.confidence >= 0.7)
    .sort((a, b) => a.table.offset - b.table.offset)

  if (globalAnchors.length >= 5) {
    // Compute a global offset shift from high-confidence anchors
    const deltas = globalAnchors.map(a => a.targetOffset - a.table.offset)
    deltas.sort((a, b) => a - b)
    const medianDelta = deltas[Math.floor(deltas.length / 2)]

    for (const table of refTables) {
      if (matched.has(table.id)) continue
      const len = tableBytes(table)
      if (len < 2) continue

      // Find closest anchor
      let closest = null, closestDist = Infinity
      for (const a of globalAnchors) {
        const dist = Math.abs(a.table.offset - table.offset)
        if (dist < closestDist) { closestDist = dist; closest = a }
      }
      if (!closest) continue

      // Estimate from closest anchor's local delta
      const localDelta = closest.targetOffset - closest.table.offset
      const localEstimate = table.offset + localDelta
      // Also estimate from global median delta
      const globalEstimate = table.offset + medianDelta

      // If both agree within tolerance, good signal
      const tolerance = Math.max(len * 2, 32)
      const estimated = Math.abs(localEstimate - globalEstimate) <= tolerance
        ? localEstimate  // local + global agree
        : closestDist < 512 ? localEstimate : null  // trust local only if very close

      if (estimated == null || estimated < 0 || estimated + len > targetData.length) continue

      // Optional byte similarity for confidence boost
      const checkLen = Math.min(len, 64)
      const sim = byteSimilarity(refData, table.offset, targetData, estimated, checkLen)
      const conf = sim >= 0.5 ? 0.55 : sim >= 0.3 ? 0.45 : 0.4

      results.push({
        table,
        targetOffset: estimated,
        confidence: conf,
        method: 'extrapolated',
      })
      matched.add(table.id)
    }
  }
  report('extrapolated')

  results.sort((a, b) => b.confidence - a.confidence)

  return {
    matches: results,
    matched: matched.size,
    total: refTables.length,
    unmatched: refTables.filter(t => !matched.has(t.id)),
  }
}

/**
 * Create table definitions from match results.
 */
export function applyMatches(matches, minConfidence = 0.5) {
  return matches
    .filter(m => m.confidence >= minConfidence)
    .map(m => ({
      ...m.table,
      id: `matched_${m.table.name}_${Date.now()}`,
      offset: m.targetOffset,
      _matchConfidence: m.confidence,
      _matchMethod: m.method,
      _refOffset: m.table.offset,
      source: 'matched',
    }))
}
