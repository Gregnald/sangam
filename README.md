# SANGAM: Smart Allocation & Network Governance for Asset Maintenance

This is the frontend prototype for the **Smart India Hackathon 2026 Problem Statement 26027**: "AI-Powered Automatic Block Planning to Maximize Asset Availability for Train Operations on Indian Railways".

## Project Purpose
SANGAM is a decision-support prototype. The application integrates maintenance data from TMS, SMMS, and TDMS with timetable and corridor context to derive candidate maintenance windows, prioritize maintenance work, and generate a deterministic simulated optimized plan for human controller review.

> **IMPORTANT**: This is a hackathon prototype, NOT a real railway control system. It does not replace operational authority or safety constraints. All Indian Railways terminology and metrics are for demonstration purposes only.

## Technology Stack
- **Framework**: React, TypeScript, Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Routing**: React Router
- **Icons**: Lucide React
- **Charts**: Recharts
- **Dates**: date-fns

## How to Run

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Development Server**:
   ```bash
   npm run dev
   ```

## Architecture & Data Flow (The Causal Engine)

The frontend is architected as if it will connect to a FastAPI backend later. The services layer creates causal relationships between domain concepts:

- **Timetable (`schedules.ts`, `trains.ts`)** + **Network (`network.ts`)** 
  ↓ 
- **`availabilityService.ts`**: Derives candidate block windows from train schedules (gaps).
  ↓
- **Maintenance (`maintenance.ts`)** 
  ↓
- **`priorityService.ts`**: Calculates a "Demo Priority Score" using deterministic risk heuristics (to be replaced by XGBoost/LightGBM).
  ↓
- **`optimizationService.ts`**: Simulates CP-SAT constraint programming to map jobs to available windows.
  ↓
- **Proposed Plan**
  ↓
- **`metricsService.ts`**: Causally generates KPIs based on the proposed plan's impact on asset availability.

## Mock Data & Placeholders
To avoid hallucinating Indian Railways data, all data in this application is strictly labeled:
- **TMS, SMMS, TDMS Data**: Synthetic
- **Timetable**: Demo Dataset
- **Network / Corridors**: Schematic Demo
- **Optimization**: Deterministic simulation for frontend demonstration

The `src/services` folder acts as an interface boundary, making it easy to swap these synthetic data sources with real REST API calls.
