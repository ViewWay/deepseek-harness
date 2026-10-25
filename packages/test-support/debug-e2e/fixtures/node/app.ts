const marker = 'break-here'

export function compute(input: number): number {
  const doubled = input * 2 // breakpoint line 4
  return doubled + 1
}

console.log(compute(2), marker)
