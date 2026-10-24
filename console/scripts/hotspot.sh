#!/usr/bin/env bash
# Make the Pi its own Wi-Fi network (no internet behind it). iPad joins ENGRAM-LAB,
# console is at https://10.42.0.1:8443. This is the cleanest offline proof for judges.
sudo nmcli device wifi hotspot ssid ENGRAM-LAB password engram2026 ifname wlan0
nmcli -g IP4.ADDRESS device show wlan0
