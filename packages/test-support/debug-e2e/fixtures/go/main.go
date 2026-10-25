package main

import "fmt"

func compute(input int) int {
	doubled := input * 2 // breakpoint line 6
	return doubled + 1
}

func main() {
	fmt.Println(compute(2))
}
