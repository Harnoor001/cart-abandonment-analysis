"""Shared matplotlib style so every chart in the project reads as one system."""

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

# Palette (validated categorical slots + neutral chrome)
BLUE = "#2a78d6"        # primary series
ORANGE = "#eb6834"      # emphasis: the thing the story is about
AQUA = "#1baf7a"
CONTEXT = "#c9c8c1"     # de-emphasised bars
LIGHT_BLUE = "#9ec5f4"
INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
SURFACE = "#fcfcfb"

BLUE_RAMP = LinearSegmentedColormap.from_list(
    "blue_ramp", ["#f2f7fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
)


def apply() -> None:
    mpl.rcParams.update({
        "figure.facecolor": SURFACE,
        "axes.facecolor": SURFACE,
        "savefig.facecolor": SURFACE,
        "figure.dpi": 110,
        "savefig.dpi": 160,
        "savefig.bbox": "tight",
        "font.family": ["Segoe UI", "DejaVu Sans"],
        "font.size": 10.5,
        "text.color": INK,
        "axes.labelcolor": INK_2,
        "axes.edgecolor": GRID,
        "axes.titlesize": 13.5,
        "axes.titleweight": "semibold",
        "axes.titlelocation": "left",
        "axes.titlepad": 26,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "axes.axisbelow": True,
        "grid.color": GRID,
        "grid.linewidth": 0.8,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "xtick.labelcolor": INK_2,
        "ytick.labelcolor": INK_2,
        "legend.frameon": False,
        "lines.linewidth": 2,
        "lines.solid_capstyle": "round",
    })


def subtitle(ax, text: str) -> None:
    """Grey one-line takeaway under the title."""
    ax.text(0, 1.02, text, transform=ax.transAxes, color=INK_2, fontsize=10, va="bottom")


def source_note(fig, text: str = "Source: Hungrly clickstream, Apr-Sep 2026 (185K sessions, synthetic)", y: float = -0.02) -> None:
    fig.text(0.01, y, text, color=MUTED, fontsize=8.5, ha="left", va="top")


def eur(x: float) -> str:
    if abs(x) >= 1e6:
        return f"€{x / 1e6:.2f}M"
    if abs(x) >= 1e3:
        return f"€{x / 1e3:.0f}K"
    return f"€{x:,.0f}"


def save(fig, name: str, folder) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    fig.savefig(folder / f"{name}.png")
