#include <stdio.h>

static int compute(int input) {
    int doubled = input * 2; /* breakpoint line 4 */
    return doubled + 1;
}

int main(void) {
    printf("%d\n", compute(2));
    return 0;
}
