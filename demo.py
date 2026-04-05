import streamlit as st
import pandas as pd
import time
from datetime import datetime

# config: terminal_interface_parameters
st.set_page_config(
    page_title="r.a.t.s. _node_0xff12",
    page_icon="🐀",
    layout="wide",
    initial_sidebar_state="expanded"
)

# style: hardware_console_css (lowercase_theme)
st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400&display=swap');
    
    .stApp {
        background-color: #0d1117;
        color: #c9d1d9;
        font-family: 'Fira Code', monospace;
    }
    
    /* metric_styling */
    [data-testid="stMetricValue"] {
        color: #3fb950 !important;
        font-size: 1.8rem !important;
    }
    
    /* sidebar_adjustment */
    section[data-testid="stSidebar"] {
        background-color: #161b22 !important;
        border-right: 1px solid #30363d;
    }
    
    /* button_override */
    .stButton>button {
        background-color: #21262d;
        border: 1px solid #30363d;
        color: #58a6ff;
        text-transform: lowercase;
        width: 100%;
        transition: 0.2s;
    }
    
    .stButton>button:hover {
        border-color: #58a6ff;
        color: #ffffff;
    }

    /* console_output_box */
    .stCodeBlock {
        border: 1px solid #30363d !important;
    }
    </style>
    """, unsafe_allow_html=True)

# init: session_registers (simulated_nvram)
if 'inventory' not in st.session_state:
    st.session_state.inventory = {
        "soda_v1": 15,
        "snack_v2": 8,
        "ramen_v1": 4
    }
if 'log_buffer' not in st.session_state:
    st.session_state.log_buffer = []

# sidebar: operator_controls
with st.sidebar:
    st.title("smart_shelf_r.a.t.s.")
    st.write("real-time autonomous tinyml shelf-monitor")
    st.divider()
    
    st.subheader("gpio_interrupt_simulation")
    target = st.selectbox("select_peripheral", list(st.session_state.inventory.keys()))
    
    if st.button("execute_pir_trigger"):
        # simulate_mcu_wake_cycle
        with st.status("waking_xiao_s3...", expanded=False):
            time.sleep(0.4) # realistic_boot_latency
            if st.session_state.inventory[target] > 0:
                st.session_state.inventory[target] -= 1
                
                # generate_believable_telemetry
                ts = datetime.now().strftime('%h:%m:%s').lower()
                inf_time = 142 + (time.time() % 10) # dynamic_inference_jitter
                log = f"> {ts} | fomo_inf: {inf_time:.1f}ms | sram: 242kb | {target} -1"
                st.session_state.log_buffer.insert(0, log)
    
    if st.button("sys_reset_inventory"):
        st.session_state.inventory = {"soda_v1": 15, "snack_v2": 8, "ramen_v1": 4}
        st.session_state.log_buffer.insert(0, f"> {datetime.now().strftime('%h:%m:%s').lower()} | factory_reset_ok")

    st.divider()
    st.write("**node_telemetry_stats**")
    st.caption("mcu: esp32_s3_sense")
    st.caption("ai_model: fomo_mobilenet_v2")
    st.caption("license: mit_open_source")

# main_interface: telemetry_display
st.title("🛰️ R.A.T.S. terminal_node_0xff12")
st.write("autonomous inventory verification via edge-inference")

# 3d_digital_twin_view
st.write("### 🧊 digital_twin_simulation [node_0xff12]")
sim_col1, sim_col2 = st.columns([2, 1])

with sim_col1:
    # logic: show a "full" or "empty" 3D render based on total stock
    total_stock = sum(st.session_state.inventory.values())
    
    if total_stock > 10:
        # replace with a link to a 3D render of a full shelf
        st.image("https://img.freepik.com/free-photo/3d-render-supermarket-shelf-with-products_23-2148937082.jpg", 
                 caption="status: nominal_load", use_container_width=True)
    else:
        # replace with a link to a 3D render of a depleted shelf
        st.image("https://img.freepik.com/free-photo/empty-white-shelves-supermarket_23-2148102604.jpg", 
                 caption="status: critical_depletion", use_container_width=True)

with sim_col2:
    st.info("the digital twin synchronizes with the xiao_s3 spatial coordinates to map product placement in 3D space.")
    st.button("refresh_spatial_map")

# layout: inventory_metrics
c1, c2, c3 = st.columns(3)
for col, (name, val) in zip([c1, c2, c3], st.session_state.inventory.items()):
    # autonomous_threshold_logic
    alert_status = "normal" if val > 3 else "inverse"
    col.metric(label=name, value=val, delta="-1" if val < 10 else None, delta_color=alert_status)

# critical_alert_system
if any(v <= 2 for v in st.session_state.inventory.values()):
    st.error("critical_low_stock_detected: autonomous_restock_protocol_initiated")

st.divider()

# layout: analytics_and_logs
left, right = st.columns([1, 1])

with left:
    st.write("### distribution_analysis")
    chart_df = pd.DataFrame(list(st.session_state.inventory.items()), columns=['id', 'qty'])
    st.bar_chart(chart_df.set_index('id'), color="#58a6ff")

with right:
    st.write("### raw_terminal_output")
    if not st.session_state.log_buffer:
        st.info("awaiting hardware interrupt signal...")
    else:
        # show last 8 logs for scannability
        for entry in st.session_state.log_buffer[:8]:
            st.code(entry, language="bash")

st.divider()
st.caption("end_of_transmission | protocol: mqtt/tls_1.3 | node: south_korea_region_01")