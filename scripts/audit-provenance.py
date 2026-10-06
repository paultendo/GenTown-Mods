#!/usr/bin/env python3
"""Record source provenance for an immutable Git tree. No game code is executed."""
import argparse
import bisect
import hashlib
import json
import re
import subprocess
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKEN = re.compile(
    r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|'
    r'`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|(?:\d+(?:\.\d*)?)|'
    r'===|!==|=>|==|!=|\?\.|\?\?|&&|\|\||\+\+|--|\*\*|[^\s]'
)
UTILITIES = ['example_mod.js', 'better_mod_loader.mjs', 'whirl-load.js', 'world-configurator.js']


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def classification(path):
    if path == 'vendor/gentown/perlin.js':
        return 'third-party-noisejs'
    if path == 'vendor/gentown/normalize.css':
        return 'third-party-normalize-css'
    if path == 'vendor/gentown/licenses/noisejs-LICENSE.txt':
        return 'third-party-noisejs-licence'
    if path == 'vendor/gentown/licenses/normalize-LICENSE.txt':
        return 'third-party-normalize-css-licence'
    if path.startswith('vendor/gentown/fonts/'):
        return 'third-party-font-or-font-licence'
    if path == 'vendor/gentown/upstream.json':
        return 'paultendo-source-metadata'
    if path.startswith('vendor/gentown/') or path.startswith('icons/'):
        return 'preserved-r74n-content-or-licence'
    if path == 'index.html':
        return 'adapted-r74n-page-with-paultendo-additions'
    if path in UTILITIES:
        return 'inherited-independent-mod-contribution'
    if path == 'mods.json':
        return 'inherited-metadata-replaced-by-local-empty-configuration'
    if path.startswith(('docs/screenshots/', 'docs/qa/')) and path.endswith(('.png', '.jpg')):
        return 'composite-capture-paultendo-and-visible-third-party-content'
    if path.startswith('app/sprites/') and path.endswith('.png') or path.startswith('artwork/paultendo-sprites/') and path.endswith('.png'):
        return 'paultendo-pixel-art-set-see-creation-and-reference-records'
    if path == 'app/sprites/data.js':
        return 'mechanically-built-paultendo-pixel-art-data'
    if path == 'package-lock.json':
        return 'paultendo-dependency-record-with-third-party-package-metadata'
    if path == 'paultendo-mod.js':
        return 'paultendo-overhaul-with-gentown-bridges-and-bundled-pixel-art'
    return 'paultendo-project-addition-subject-to-identified-quotations-and-notices'


def tokens(text):
    newlines = [m.start() for m in re.finditer('\n', text)]
    return [(m.group(), bisect.bisect_right(newlines, m.start()) + 1)
            for m in TOKEN.finditer(text)
            if not m.group().startswith(('//', '/*'))]


def shared_fragments(source, target, minimum=40):
    """Find verbatim token runs ignoring whitespace/comments, without renaming.

    This is a textual screening tool, not a JavaScript parser or authorship test.
    Regex literals and template interpolations are not semantically normalised.
    """
    sv, tv = [x[0] for x in source], [x[0] for x in target]
    width = 20
    index = {}
    for j in range(len(target) - width + 1):
        index.setdefault(tuple(tv[j:j + width]), []).append(j)
    accepted, results = [], []
    for i in range(len(source) - width + 1):
        for j in index.get(tuple(sv[i:i + width]), []):
            if any(a <= i < b and c <= j < d for a, b, c, d in accepted):
                continue
            a, b = i, j
            while a and b and sv[a - 1] == tv[b - 1]:
                a -= 1
                b -= 1
            endi, endj = i + width, j + width
            while endi < len(sv) and endj < len(tv) and sv[endi] == tv[endj]:
                endi += 1
                endj += 1
            if endi - a < minimum:
                continue
            accepted.append((a, endi, b, endj))
            results.append({'sourceStart': source[a][1], 'sourceEnd': source[endi - 1][1],
                            'targetStart': target[b][1], 'targetEnd': target[endj - 1][1],
                            'tokens': endi - a})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--output', required=True)
    parser.add_argument('--date', required=True, help='Date the audit was performed, YYYY-MM-DD')
    parser.add_argument('--verify-live', action='store_true', help='Fetch recorded official URLs using curl and compare bytes')
    parser.add_argument('--verify-pixels', action='store_true', help='Compare decoded sprite pixels with original icons using ImageMagick')
    args = parser.parse_args()
    commit = git('rev-parse', args.ref + '^{commit}').decode().strip()
    paths = git('ls-tree', '-r', '--name-only', commit).decode().splitlines()
    blobs = {p: git('show', commit + ':' + p) for p in paths}
    inventory = []
    for p in paths:
        introduced = git('log', '--reverse', '--diff-filter=A', '--format=%H%x09%aI%x09%an', commit, '--', p).decode().splitlines()
        first = introduced[0].split('\t', 2) if introduced else None
        original = git('show', first[0] + ':' + p) if first else None
        inventory.append({'path': p, 'sha256': sha(blobs[p]), 'bytes': len(blobs[p]),
                          'classification': classification(p),
                          'firstRecordedCommit': first[0] if first else None,
                          'firstRecordedDate': first[1] if first else None,
                          'firstRecordedCommitAuthor': first[2] if first else None,
                          'unchangedSinceFirstRecordedCommit': blobs[p] == original if first else None})
    upstream = json.loads(blobs['vendor/gentown/upstream.json'])
    checks = []
    def fetch(url):
        return subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '30', url], stderr=subprocess.PIPE)

    for name, record in upstream.items():
        if 'sha256' not in record:
            continue
        p = name if name.startswith('icons/') else 'vendor/gentown/' + name
        check = {'path': p, 'source': record['url'], 'expectedSha256': record['sha256'],
                 'actualSha256': sha(blobs[p]), 'matchesRecordedSourceHash': sha(blobs[p]) == record['sha256']}
        if args.verify_live:
            try:
                live = fetch(record['url'])
                check.update(liveSha256=sha(live), matchesLiveSource=live == blobs[p])
            except subprocess.CalledProcessError as error:
                check.update(liveFetchFailed=True, error=error.stderr.decode().strip())
        checks.append(check)
    independent = []
    if args.verify_live:
        reference_urls = [
            ('noisejs-code', 'https://raw.githubusercontent.com/josephg/noisejs/9c53d7faed1c1a1d4c0927b238ff3def7bb8803b/perlin.js', 'vendor/gentown/perlin.js'),
            ('noisejs-licence', 'https://raw.githubusercontent.com/josephg/noisejs/9c53d7faed1c1a1d4c0927b238ff3def7bb8803b/LICENSE', None),
            ('normalize-css-code', 'https://raw.githubusercontent.com/necolas/normalize.css/8.0.1/normalize.css', 'vendor/gentown/normalize.css'),
            ('normalize-css-licence', 'https://raw.githubusercontent.com/necolas/normalize.css/8.0.1/LICENSE.md', None),
            ('original-game-page', 'https://r74n.com/gentown/', None),
        ]
        for name, url, path in reference_urls:
            record = {'id': name, 'source': url}
            try:
                content = fetch(url)
                record.update(sha256=sha(content), bytes=len(content))
                if path:
                    record.update(localPath=path, identicalBytes=content == blobs[path])
                    if name == 'normalize-css-code':
                        def css_rules(data):
                            return re.sub(r'\s+', '', re.sub(r'/\*[\s\S]*?\*/', '', data.decode()))
                        record['identicalRulesIgnoringCommentsAndWhitespace'] = css_rules(content) == css_rules(blobs[path])
            except subprocess.CalledProcessError as error:
                record.update(fetchFailed=True, error=error.stderr.decode().strip())
            independent.append(record)
    mod_tokens = tokens(blobs['paultendo-mod.js'].decode())
    references = [p for p in paths if p.startswith('vendor/gentown/') and p.endswith('.js')] + UTILITIES
    shared = []
    for p in references:
        for match in shared_fragments(tokens(blobs[p].decode()), mod_tokens):
            shared.append({'source': p, 'target': 'paultendo-mod.js', **match})
    manifest = json.loads(blobs['artwork/paultendo-sprites/manifest.json'])
    artwork = []
    for asset in manifest['assets']:
        for key, digest in [('file', 'sha256'), ('source', 'sourceSha256')]:
            p = str((ROOT / 'artwork/paultendo-sprites' / asset[key]).resolve().relative_to(ROOT))
            artwork.append({'asset': asset['id'], 'kind': key, 'path': p,
                            'sha256': sha(blobs[p]), 'matchesManifest': sha(blobs[p]) == asset[digest]})
    pixel_check = None
    if args.verify_pixels:
        if not shutil.which('magick'):
            raise SystemExit('--verify-pixels requires ImageMagick (magick)')
        def pixel_digest(path):
            size = subprocess.check_output(['magick', 'identify', '-format', '%wx%h', 'png:-'], input=blobs[path])
            rgba = subprocess.check_output(['magick', 'png:-', '-alpha', 'on', '-depth', '8', 'rgba:-'], input=blobs[path])
            return sha(size + b'\0' + rgba)
        icons = {p: pixel_digest(p) for p in paths if p.startswith('icons/') and p.endswith('.png')}
        exports = {x['path']: pixel_digest(x['path']) for x in artwork if x['kind'] == 'file'}
        pixel_check = {'method': 'Compare dimensions and decoded 8-bit RGBA pixels. This detects identical images, not visual influence or authorship.',
                       'toolVersion': subprocess.check_output(['magick', '-version']).decode().splitlines()[0],
                       'originalIconCount': len(icons), 'addedExportCount': len(exports),
                       'identicalImages': [{'export': e, 'originalIcon': i} for e, eh in exports.items() for i, ih in icons.items() if eh == ih]}
    lock = json.loads(blobs['package-lock.json'])
    dependencies = [{'path': p, 'version': v.get('version'), 'licenceIdentifier': v.get('license'),
                     'resolved': v.get('resolved'), 'integrity': v.get('integrity')}
                    for p, v in lock['packages'].items() if p]
    mod = blobs['paultendo-mod.js'].decode()
    start = mod.index('    // BEGIN GENERATED SPRITES')
    end = mod.index('    // END GENERATED SPRITES') + len('    // END GENERATED SPRITES')
    bundled = mod[start:end].encode()
    report = {'schemaVersion': 1, 'auditDate': args.date, 'sourceCommit': commit,
              'scope': 'Immutable Git tree at sourceCommit. New audit documents and later changes are outside this snapshot.',
              'limits': ['Git records attribution and sequence, not conclusive legal authorship.',
                         'Token screening compares only the listed preserved sources. It does not identify semantic adaptations, renamed copies, unknown sources or independent creation.',
                         'Shared API identifiers do not by themselves establish copying. The shared revolution bridge receives manual review in the companion report.',
                         'No automated copyright, licence-enforceability or permission conclusion is made.'],
              'inventory': inventory, 'classificationCounts': dict(Counter(x['classification'] for x in inventory)),
              'upstreamHashes': checks, 'sharedTokenScreen': {'minimumTokens': 40, 'sources': references, 'matches': shared},
              'authoritativeReferenceChecks': independent,
              'artworkManifestChecks': artwork, 'artworkStyleReferences': manifest['styleReferences'],
              'artworkPixelComparison': pixel_check,
              'bundledArtwork': {'lines': len(bundled.splitlines()), 'bytes': len(bundled), 'sha256': sha(bundled)},
              'dependencies': dependencies}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    failed = [x['path'] for x in checks if not x['matchesRecordedSourceHash'] or x.get('liveFetchFailed') or x.get('matchesLiveSource') is False]
    failed += [x['path'] for x in artwork if not x['matchesManifest']]
    failed += [x['id'] for x in independent if x.get('fetchFailed') or x.get('id') == 'noisejs-code' and x.get('identicalBytes') is False or x.get('id') == 'normalize-css-code' and x.get('identicalRulesIgnoringCommentsAndWhitespace') is False]
    print(json.dumps({'sourceCommit': commit, 'files': len(inventory), 'upstreamHashChecks': len(checks),
                      'artworkHashChecks': len(artwork), 'sharedFragmentsAt40Tokens': len(shared),
                      'sharedFragmentsAt80Tokens': sum(x['tokens'] >= 80 for x in shared), 'failedChecks': failed}))
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
