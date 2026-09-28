"""Parallel HTTP range downloader (resumable). Usage: python download.py URL OUT [threads]"""
import os
import sys
import threading
import time
import urllib.request

CHUNK = 128 << 20
UA = {"User-Agent": "EvolutionTreeBuilder/1.0"}


def download(url, out, threads=8, chunk=CHUNK, log=print):
    req = urllib.request.Request(url, method="HEAD", headers=UA)
    size = int(urllib.request.urlopen(req, timeout=60).headers["Content-Length"])
    state = out + ".done"
    done = set()
    if os.path.exists(state):
        done = {int(x) for x in open(state).read().split()}
    if not os.path.exists(out):
        with open(out, "wb") as f:
            f.truncate(size)
    chunks = [i for i in range(0, size, chunk) if i not in done]
    lock = threading.Lock()
    got = [len(done) * chunk]
    failed = []
    t0 = time.time()

    def work():
        while True:
            with lock:
                if not chunks:
                    return
                start = chunks.pop(0)
            end = min(start + chunk, size) - 1
            for attempt in range(10):
                try:
                    r = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", **UA})
                    data = urllib.request.urlopen(r, timeout=60).read()
                    if len(data) != end - start + 1:
                        raise IOError("short read")
                    with open(out, "r+b") as f:
                        f.seek(start)
                        f.write(data)
                    with lock:
                        with open(state, "a") as s:
                            s.write(f"{start}\n")
                        got[0] += len(data)
                        el = time.time() - t0
                        log(f"{got[0] / size * 100:5.1f}%  {got[0] / 1e9:.1f}/{size / 1e9:.1f} GB  {el:.0f}s")
                    break
                except Exception as ex:
                    log(f"retry {start}: {ex!r}")
                    time.sleep(2 ** min(attempt, 5))
            else:
                log(f"FAILED chunk {start}")
                failed.append(start)

    ts = [threading.Thread(target=work) for _ in range(threads)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    if failed:
        raise IOError(f"{len(failed)} chunks failed for {url}")
    os.remove(state)
    return size


def main():
    url, out = sys.argv[1], sys.argv[2]
    threads = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    download(url, out, threads, log=lambda s: print(s, flush=True))
    print("COMPLETE", flush=True)


if __name__ == "__main__":
    main()
