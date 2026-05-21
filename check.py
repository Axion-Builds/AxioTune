import sys
import py_compile

def check_js(filename):
    import subprocess
    try:
        # Just use quickjs or something? Or python's re to find obvious stuff.
        # Even better, we can just run a python embedded js engine if available. No.
        pass
    except Exception as e:
        pass

if __name__ == "__main__":
    pass
