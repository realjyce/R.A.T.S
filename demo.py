import streamlit as st
import streamlit.components.v1 as components
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
    .stApp { background-color: #0d1117; color: #c9d1d9; font-family: 'Fira Code', monospace; }
    [data-testid="stMetricValue"] { color: #3fb950 !important; font-size: 1.8rem !important; }
    section[data-testid="stSidebar"] { background-color: #161b22 !important; border-right: 1px solid #30363d; }
    .stButton>button { background-color: #21262d; border: 1px solid #30363d; color: #58a6ff; text-transform: lowercase; width: 100%; transition: 0.2s; }
    .stButton>button:hover { border-color: #58a6ff; color: #ffffff; }
    .stCodeBlock { border: 1px solid #30363d !important; }
    </style>
    """, unsafe_allow_html=True)

# init: session_registers
if 'inventory' not in st.session_state:
    st.session_state.inventory = {"soda_v1": 15, "snack_v2": 8, "ramen_v1": 4}
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
        with st.status("waking_xiao_s3...", expanded=False):
            time.sleep(0.4) 
            if st.session_state.inventory[target] > 0:
                st.session_state.inventory[target] -= 1
                ts = datetime.now().strftime('%h:%m:%s').lower()
                inf_time = 142 + (time.time() % 10) 
                log = f"> {ts} | fomo_inf: {inf_time:.1f}ms | sram: 242kb | {target} -1"
                st.session_state.log_buffer.insert(0, log)
    
    if st.button("sys_reset_inventory"):
        st.session_state.inventory = {"soda_v1": 15, "snack_v2": 8, "ramen_v1": 4}
        st.session_state.log_buffer.insert(0, f"> {datetime.now().strftime('%h:%m:%s').lower()} | factory_reset_ok")

# main_interface
st.title("🛰️ r.a.t.s. terminal_node_0xff12")

# 1. interactive_3d_section
st.write("### 🧊 digital_twin_spatial_mapping")
# note: this is a public spline 3d room/shelf model. you can rotate it with your mouse!
components.html(
    """
    <iframe src='https://my.spline.design/roomrelaxingcopy-469a473e130dfc36082260f898394474/' 
    frameborder='0' width='100%' height='500px'></iframe>
    """,
    height=500,
)
st.caption("3d environment synced to xiao_s3 focal point coordinates.")

st.divider()

# 2. layout: inventory_metrics
c1, c2, c3 = st.columns(3)
for col, (name, val) in zip([c1, c2, c3], st.session_state.inventory.items()):
    alert_status = "normal" if val > 3 else "inverse"
    col.metric(label=name, value=val, delta="-1" if val < 10 else None, delta_color=alert_status)

if any(v <= 2 for v in st.session_state.inventory.values()):
    st.error("critical_low_stock_detected: autonomous_restock_protocol_initiated")

st.divider()

# 3. layout: analytics_and_logs
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
        for entry in st.session_state.log_buffer[:8]:
            st.code(entry, language="bash")

st.divider()
st.caption("end_of_transmission | protocol: mqtt/tls_1.3 | node: south_korea_region_01")