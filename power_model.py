"""
R.A.T.S — Deep-Sleep power & cost model (slide generator)

Projects battery life and annual service cost for the PIR-gated deep-sleep XIAO
vs an always-on device, from a duty cycle. Prints a comparison table and saves a
chart (power_compare.png) you can drop straight into a presentation.

The duty cycle is the one number that matters: the fraction of time the device is
awake. Get it from the live demo (the device measures it) and pass --duty, or use
the default for a representative shelf.

Usage:
    python power_model.py                          # defaults (4% duty, 1000 mAh)
    python power_model.py --duty 0.04 --battery 1000
    python power_model.py --from-backend           # pull live measured duty from server.py
    python power_model.py --no-chart               # table only

Current figures are NOMINAL (datasheet/typical XIAO ESP32-S3 Sense). Replace with
bench-measured values for a bulletproof number.
"""

import argparse

# ── Nominal assumptions (keep in sync with server.py) ────────────────────────
I_ACTIVE_MA      = 150.0    # camera + WiFi + FOMO inference, typical avg draw
I_SLEEP_MA       = 0.014    # ~14 µA deep sleep (Seeed XIAO ESP32-S3 spec)
COST_PER_SERVICE = 5.0      # $ per recharge/replacement visit (labor + battery)


def model(duty, battery_mAh, i_active=I_ACTIVE_MA, i_sleep=I_SLEEP_MA,
          cost_per_service=COST_PER_SERVICE):
    """Return the deep-sleep vs always-on projection for one duty cycle."""
    duty   = min(max(duty, 0.0), 1.0)
    avg_mA = i_active * duty + i_sleep * (1.0 - duty)

    life_deep   = battery_mAh / avg_mA   / 24.0   # days
    life_always = battery_mAh / i_active / 24.0   # days

    per_year = lambda life: (365.0 / life) if life > 0 else 0.0
    return {
        "duty_pct":         duty * 100,
        "avg_mA":           avg_mA,
        "life_days_deep":   life_deep,
        "life_days_always": life_always,
        "energy_saved_pct": (1 - avg_mA / i_active) * 100,
        "cost_yr_deep":     per_year(life_deep)   * cost_per_service,
        "cost_yr_always":   per_year(life_always) * cost_per_service,
        "battery_mAh":      battery_mAh,
        "i_active":         i_active,
        "i_sleep":          i_sleep,
    }


def fmt_life(days):
    return f"{days:.1f} days" if days >= 1 else f"{days * 24:.1f} hours"


def print_table(m):
    bar = "-" * 52
    print(f"\n{bar}")
    print(f"  R.A.T.S Deep-Sleep Power & Cost  |  duty = {m['duty_pct']:.1f}%")
    print(f"  battery {m['battery_mAh']:.0f} mAh | active {m['i_active']:.0f} mA | "
          f"sleep {m['i_sleep']*1000:.0f} uA")
    print(bar)
    print(f"  {'':<18}{'Always-on':>16}{'Deep-sleep':>16}")
    print(f"  {'Avg current':<18}{m['i_active']:>13.1f} mA{m['avg_mA']:>13.2f} mA")
    print(f"  {'Battery life':<18}{fmt_life(m['life_days_always']):>16}{fmt_life(m['life_days_deep']):>16}")
    print(f"  {'Cost / yr / shelf':<18}{'$'+format(m['cost_yr_always'],'.0f'):>16}{'$'+format(m['cost_yr_deep'],'.2f'):>16}")
    print(bar)
    print(f"  Energy saved: {m['energy_saved_pct']:.1f}%   "
          f"Battery lasts {m['life_days_deep']/m['life_days_always']:.0f}x longer")
    print(f"{bar}\n")


def save_chart(m, path="power_compare.png"):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = ["Always-on", "Deep-sleep"]
    red, green = "#EF4444", "#22C55E"
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4.2))
    fig.suptitle(f"R.A.T.S — Deep-Sleep Saving  (duty {m['duty_pct']:.1f}%, "
                 f"{m['battery_mAh']:.0f} mAh)", fontsize=13, fontweight="bold")

    # Battery life (days)
    life = [m["life_days_always"], m["life_days_deep"]]
    b1 = ax1.bar(labels, life, color=[red, green], width=0.55)
    ax1.set_title("Battery life (days)")
    ax1.bar_label(b1, labels=[fmt_life(v) for v in life], padding=3, fontsize=10)
    ax1.set_ylim(0, max(life) * 1.18)
    ax1.spines[["top", "right"]].set_visible(False)

    # Annual cost ($)
    cost = [m["cost_yr_always"], m["cost_yr_deep"]]
    b2 = ax2.bar(labels, cost, color=[red, green], width=0.55)
    ax2.set_title("Service cost / year / shelf ($)")
    ax2.bar_label(b2, labels=[f"${v:,.0f}" for v in cost], padding=3, fontsize=10)
    ax2.set_ylim(0, max(cost) * 1.18)
    ax2.spines[["top", "right"]].set_visible(False)

    fig.text(0.5, 0.01, f"Energy saved {m['energy_saved_pct']:.1f}%  ·  nominal: "
             f"{m['i_active']:.0f} mA active / {m['i_sleep']*1000:.0f} µA sleep",
             ha="center", fontsize=9, color="#666")
    fig.tight_layout(rect=[0, 0.03, 1, 0.95])
    fig.savefig(path, dpi=150)
    print(f"[saved] {path}")


def duty_from_backend(url):
    """Pull the live, device-measured duty cycle from a running server.py."""
    import requests
    d = requests.get(url, timeout=4).json()
    print(f"[backend] measured duty {d['duty_pct']}% across {d['wake_count']} wake cycles")
    return d["duty_pct"] / 100.0


def main():
    ap = argparse.ArgumentParser(description="Deep-sleep power & cost model")
    ap.add_argument("--duty", type=float, default=0.04, help="awake fraction 0–1 (default 0.04 = 4%%)")
    ap.add_argument("--battery", type=float, default=1000.0, help="battery capacity mAh (default 1000)")
    ap.add_argument("--active", type=float, default=I_ACTIVE_MA, help="active current mA")
    ap.add_argument("--sleep", type=float, default=I_SLEEP_MA, help="deep-sleep current mA")
    ap.add_argument("--cost", type=float, default=COST_PER_SERVICE, help="$ per service visit")
    ap.add_argument("--from-backend", metavar="URL", nargs="?",
                    const="http://localhost:5000/xiao/power",
                    help="fetch live measured duty from server.py (default localhost:5000)")
    ap.add_argument("--no-chart", action="store_true", help="skip the PNG")
    args = ap.parse_args()

    duty = args.duty
    if args.from_backend:
        try:
            duty = duty_from_backend(args.from_backend)
        except Exception as e:
            print(f"[warn] backend unreachable ({e}); using --duty {args.duty}")

    m = model(duty, args.battery, args.active, args.sleep, args.cost)
    print_table(m)
    if not args.no_chart:
        save_chart(m)


if __name__ == "__main__":
    main()
