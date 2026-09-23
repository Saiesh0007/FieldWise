package com.fieldwise.app

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.fieldwise.map.GpsController
import com.fieldwise.map.MapScreen
import com.fieldwise.ui.home.HomeScreen
import com.fieldwise.ui.optimizer.OptimizerScreen
import com.fieldwise.ui.simulation.SimulatorScreen
import com.fieldwise.ui.simulation.MissionCompleteScreen
import com.fieldwise.ui.history.HistoryScreen

private val LOCATION_PERMISSIONS = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION
)

class MainActivity : ComponentActivity() {
    private lateinit var gpsController: GpsController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        gpsController = GpsController(applicationContext)
        setContent { FieldWiseRoot(gpsController, applicationContext) }
    }

    override fun onDestroy() {
        super.onDestroy()
        gpsController.stopAllTracking()
    }
}

@Composable
private fun FieldWiseRoot(gpsController: GpsController, context: android.content.Context) {
    val viewModel: FieldWiseViewModel = viewModel(
        factory = object : androidx.lifecycle.ViewModelProvider.Factory {
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return FieldWiseViewModel(gpsController, context) as T
            }
        }
    )
    val navController = rememberNavController()

    // Request location permissions at startup
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            gpsController.getLastKnownLocation()
        }
    }

    LaunchedEffect(Unit) {
        if (gpsController.hasLocationPermission()) {
            gpsController.getLastKnownLocation()
        } else {
            permissionLauncher.launch(LOCATION_PERMISSIONS)
        }
    }

    FieldWiseNavHost(viewModel, navController, gpsController)
}

@Composable
private fun FieldWiseNavHost(
    viewModel: FieldWiseViewModel,
    navController: NavHostController,
    gpsController: GpsController
) {
    val mapState by viewModel.mapState.collectAsStateWithLifecycle()
    val simulationState by viewModel.simulationState.collectAsStateWithLifecycle()
    val missions by viewModel.missions.collectAsStateWithLifecycle()
    val comparisonPlan by viewModel.comparisonPlan.collectAsStateWithLifecycle()

    NavHost(navController, startDestination = Screen.Home.route) {
        composable(Screen.Home.route) {
            HomeScreen(
                onCreateField = {
                    viewModel.resetField()
                    navController.navigate(Screen.MapEditor.route)
                },
                onLoadDemo = {
                    viewModel.loadDemoField()
                    navController.navigate(Screen.MapEditor.route)
                },
                onViewHistory = {
                    navController.navigate(Screen.History.route)
                }
            )
        }

        composable(Screen.MapEditor.route) {
            MapScreen(
                state = mapState,
                actions = viewModel.mapActions(gpsController)
            )
        }

        composable(Screen.Optimizer.route) {
            OptimizerScreen(
                mapState = mapState,
                mapActions = viewModel.mapActions(gpsController),
                onSimulate = {
                    viewModel.startSimulation()
                    navController.navigate(Screen.Simulator.route)
                },
                onOpenReview = {
                    // Navigate to review screen (MapScreen in review mode)
                    navController.navigate(Screen.MapEditor.route)
                },
                onCompare = {
                    viewModel.generateStandardComparison()
                },
                onClearComparison = {
                    viewModel.clearComparison()
                },
                comparisonPlan = comparisonPlan
            )
        }

        composable(Screen.Simulator.route) {
            SimulatorScreen(
                mapState = mapState,
                simulationState = simulationState,
                onStart = { viewModel.startSimulation() },
                onPause = { viewModel.pauseSimulation() },
                onResume = { viewModel.resumeSimulation() },
                onRestart = { viewModel.restartSimulation() },
                onStop = { navController.popBackStack() },
                onMissionComplete = {
                    navController.navigate(Screen.MissionComplete.route) {
                        popUpTo(Screen.Simulator.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.MissionComplete.route) {
            val plan = mapState.sprayState.plan
            if (plan != null) {
                MissionCompleteScreen(
                    plan = plan,
                    onSaveMission = { name ->
                        viewModel.saveMission(name)
                        navController.navigate(Screen.Home.route) {
                            popUpTo(Screen.Home.route) { inclusive = true }
                        }
                    },
                    onExport = { format ->
                        viewModel.exportMission(format)
                    },
                    onViewHistory = {
                        navController.navigate(Screen.History.route)
                    }
                )
            }
        }

        composable(Screen.History.route) {
            HistoryScreen(
                missions = missions,
                onMissionSelected = { record ->
                    viewModel.loadMission(record)
                    navController.navigate(Screen.Optimizer.route)
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object MapEditor : Screen("map_editor")
    data object Optimizer : Screen("optimizer")
    data object Simulator : Screen("simulator")
    data object MissionComplete : Screen("mission_complete")
    data object History : Screen("history")
}
