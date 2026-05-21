import tokenize
import io

with open('app.js', 'r', encoding='utf-8') as f:
    text = f.read()

stack = []
def check():
    in_string = False
    in_comment = False
    in_multiline_comment = False
    string_char = ''
    i = 0
    while i < len(text):
        c = text[i]
        if not in_string and not in_comment and not in_multiline_comment:
            if c == '/' and i + 1 < len(text):
                if text[i+1] == '/':
                    in_comment = True
                    i += 1
                elif text[i+1] == '*':
                    in_multiline_comment = True
                    i += 1
            elif c in '"\'`':
                in_string = True
                string_char = c
            elif c in '([{':
                stack.append((c, i))
            elif c in ')]}':
                if not stack:
                    print(f"Unmatched {c} at {i}")
                    return i
                last_c, last_i = stack.pop()
                if (c == ')' and last_c != '(') or (c == ']' and last_c != '[') or (c == '}' and last_c != '{'):
                    print(f"Mismatch at {i}: expected match for {last_c} at {last_i}, found {c}")
                    return i
        elif in_string:
            if c == '\\':
                i += 1
            elif c == string_char:
                in_string = False
        elif in_comment:
            if c == '\n':
                in_comment = False
        elif in_multiline_comment:
            if c == '*' and i + 1 < len(text) and text[i+1] == '/':
                in_multiline_comment = False
                i += 1
        i += 1
    
    for c, idx in stack:
        print(f"Unmatched {c} at {idx}")
        return idx
    print("All good!")
    return -1

idx = check()
if idx != -1:
    lines = text.split('\n')
    current_idx = 0
    for line_no, line in enumerate(lines):
        if current_idx <= idx <= current_idx + len(line):
            print("--- Context around line", line_no + 1, "---")
            for j in range(max(0, line_no-5), min(len(lines), line_no+6)):
                print(f"{j+1}: {lines[j]}")
            break
        current_idx += len(line) + 1
