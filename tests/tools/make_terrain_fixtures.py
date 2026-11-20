"""Gera os GeoTIFF de referência dos testes do leitor (`apps/web/src/terrain/geotiff.ts`).

Os arquivos são escritos pela libtiff (via Pillow), uma implementação independente do leitor:
servem para conferir a descompressão LZW e Deflate e a leitura das chaves GeoTIFF. As cotas
seguem a mesma fórmula usada no teste (`terrain.web.test.ts`).

Uso: python tests/tools/make_terrain_fixtures.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, TiffImagePlugin

OUT = Path(__file__).resolve().parents[2] / "apps" / "web" / "src" / "terrain" / "fixtures"
WIDTH, HEIGHT = 64, 48


def elevation(col: int, row: int) -> float:
    return 700 + 0.5 * col + 0.25 * row + (((col * 7919) ^ (row * 104729)) % 1000) / 100


def geo_tags(keys: list[int], scale: float, east: float, north: float, nodata: str | None):
    info = TiffImagePlugin.ImageFileDirectory_v2()
    info[33550] = (scale, scale, 0.0)
    info.tagtype[33550] = 12
    info[33922] = (0.0, 0.0, 0.0, east, north, 0.0)
    info.tagtype[33922] = 12
    info[34735] = tuple([1, 1, 0, len(keys) // 4, *keys])
    info.tagtype[34735] = 3
    if nodata is not None:
        info[42113] = nodata
        info.tagtype[42113] = 2
    return info


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    grid = np.array(
        [[elevation(c, r) for c in range(WIDTH)] for r in range(HEIGHT)], dtype=np.float64
    )

    # Real de 32 bits, LZW, SIRGAS 2000 / UTM 23S, célula de 5 m, PixelIsArea, NODATA -9999.
    real = grid.astype(np.float32)
    real[3, 4] = -9999.0
    Image.fromarray(real).save(
        OUT / "dem-utm23s-lzw-f32.tif",
        compression="tiff_lzw",
        tiffinfo=geo_tags(
            [1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 31983, 4096, 0, 1, 5781, 4099, 0, 1, 9001],
            5.0,
            333000.0,
            7395000.0,
            "-9999",
        ),
    )

    # Inteiro de 16 bits, Deflate, WGS 84 geográfico, célula de 1 segundo de arco.
    integer = np.round(grid).astype(np.uint16)
    Image.fromarray(integer).save(
        OUT / "dem-wgs84-deflate-i16.tif",
        compression="tiff_adobe_deflate",
        tiffinfo=geo_tags(
            [1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326],
            1 / 3600,
            -46.64,
            -23.54,
            None,
        ),
    )
    for path in sorted(OUT.glob("*.tif")):
        print(path.name, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()