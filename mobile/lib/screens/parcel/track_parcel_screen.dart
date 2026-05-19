import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/parcel.dart';
import '../../providers/parcel_provider.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class TrackParcelScreen extends ConsumerStatefulWidget {
  const TrackParcelScreen({super.key});

  @override
  ConsumerState<TrackParcelScreen> createState() => _TrackParcelScreenState();
}

class _TrackParcelScreenState extends ConsumerState<TrackParcelScreen> {
  final _trackingController = TextEditingController();
  bool _isSearching = false;
  Parcel? _trackedParcel;

  Future<void> _trackParcel() async {
    final trackingNumber = _trackingController.text.trim();
    if (trackingNumber.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Veuillez entrer un numéro de suivi')),
      );
      return;
    }
    
    setState(() => _isSearching = true);
    
    try {
      final parcel = await ref.read(parcelProvider.notifier).trackParcel(trackingNumber);
      setState(() {
        _isSearching = false;
        _trackedParcel = parcel;
      });
      
      if (parcel == null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Colis non trouvé'), backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      setState(() => _isSearching = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // Vérifier si une étape est complétée
  bool _isStepCompleted(Parcel parcel, String stepStatus) {
    final statusOrder = [
      'pending',
      'confirmed', 
      'picked_up',
      'in_transit',
      'arrived',
      'out_for_delivery',
      'delivered'
    ];
    
    final currentIndex = statusOrder.indexOf(parcel.status.value);
    final stepIndex = statusOrder.indexOf(stepStatus);
    
    return currentIndex >= stepIndex;
  }

  Widget _buildStatusTimeline(Parcel parcel) {
    const steps = [
      {'status': 'pending', 'label': 'Création', 'icon': Icons.create},
      {'status': 'confirmed', 'label': 'Confirmé', 'icon': Icons.check_circle},
      {'status': 'picked_up', 'label': 'Ramassé', 'icon': Icons.local_shipping},
      {'status': 'in_transit', 'label': 'En transit', 'icon': Icons.transfer_within_a_station},
      {'status': 'arrived', 'label': 'Arrivé', 'icon': Icons.location_on},
      {'status': 'out_for_delivery', 'label': 'En livraison', 'icon': Icons.delivery_dining},
      {'status': 'delivered', 'label': 'Livré', 'icon': Icons.check_circle},
    ];

    return Column(
      children: steps.asMap().entries.map((entry) {
        final index = entry.key;
        final step = entry.value;
        final isCompleted = _isStepCompleted(parcel, step['status'] as String);
        final isLast = index == steps.length - 1;
        final isCurrent = parcel.status.value == step['status'];
        
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isCompleted ? const Color(0xFF0B6E3A) : Colors.grey.shade300,
                  ),
                  child: Icon(step['icon'] as IconData, color: Colors.white, size: 20),
                ),
                if (!isLast)
                  Container(
                    width: 2,
                    height: 60,
                    color: isCompleted ? const Color(0xFF0B6E3A) : Colors.grey.shade300,
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      step['label'] as String,
                      style: TextStyle(
                        fontWeight: isCompleted ? FontWeight.bold : FontWeight.normal,
                        color: isCompleted ? const Color(0xFF0B6E3A) : Colors.grey,
                      ),
                    ),
                    if (isCurrent)
                      const Text(
                        'En cours',
                        style: TextStyle(fontSize: 12, color: Color(0xFF0B6E3A)),
                      ),
                    if (step['status'] == 'delivered' && parcel.deliveryDate != null)
                      Text(
                        _formatDate(parcel.deliveryDate!),
                        style: const TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      }).toList(),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} à ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }

  void _shareTrackingNumber() {
    if (_trackedParcel != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Partager: ${_trackedParcel!.trackingNumber}'), backgroundColor: Colors.blue),
      );
    }
  }

  void _downloadReceipt() {
    if (_trackedParcel != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Téléchargement du reçu en cours...'), backgroundColor: Colors.blue),
      );
    }
  }

  void _makePhoneCall(String phoneNumber) {
    if (phoneNumber.isNotEmpty) {
      // Utiliser url_launcher pour faire un vrai appel
      // launch('tel:$phoneNumber');
      debugPrint('Appel vers: $phoneNumber');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Suivre un colis'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Recherche
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    CustomTextField(
                      controller: _trackingController,
                      label: 'Numéro de suivi',
                      prefixIcon: Icons.search,
                      hint: 'Ex: PC-20260519-0105A7',
                    ),
                    const SizedBox(height: 16),
                    CustomButton(
                      text: 'Suivre mon colis',
                      onPressed: _trackParcel,
                      isLoading: _isSearching,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            
            // Résultat
            if (_trackedParcel != null) ...[
              Card(
                elevation: 2,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _trackedParcel!.trackingNumber,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  fontFamily: 'monospace',
                                ),
                              ),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _trackedParcel!.status.color.withAlpha(25),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  _trackedParcel!.status.label,
                                  style: TextStyle(fontSize: 12, color: _trackedParcel!.status.color),
                                ),
                              ),
                            ],
                          ),
                          if (_trackedParcel!.price != null)
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                const Text('Montant', style: TextStyle(fontSize: 12, color: Colors.grey)),
                                Text(
                                  '${_trackedParcel!.price!.toInt()} FCFA',
                                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0B6E3A)),
                                ),
                              ],
                            ),
                        ],
                      ),
                      const Divider(height: 32),
                      
                      // Timeline
                      _buildStatusTimeline(_trackedParcel!),
                      const Divider(height: 32),
                      
                      // Informations
                      ListTile(
                        leading: const Icon(Icons.person, color: Colors.blue),
                        title: const Text('Destinataire'),
                        subtitle: Text(_trackedParcel!.receiverName),
                        trailing: IconButton(
                          icon: const Icon(Icons.phone, color: Colors.green),
                          onPressed: () => _makePhoneCall(_trackedParcel!.receiverPhone),
                        ),
                      ),
                      ListTile(
                        leading: const Icon(Icons.description, color: Colors.orange),
                        title: const Text('Description'),
                        subtitle: Text(_trackedParcel!.description),
                      ),
                      ListTile(
                        leading: const Icon(Icons.fitness_center, color: Colors.purple),
                        title: const Text('Poids'),
                        subtitle: Text('${_trackedParcel!.weight} kg'),
                      ),
                      if (_trackedParcel!.driverName != null && _trackedParcel!.driverName!.isNotEmpty)
                        ListTile(
                          leading: const Icon(Icons.delivery_dining, color: Colors.green),
                          title: const Text('Chauffeur'),
                          subtitle: Text(_trackedParcel!.driverName!),
                          trailing: IconButton(
                            icon: const Icon(Icons.phone, color: Colors.green),
                            onPressed: () => _makePhoneCall(_trackedParcel!.driverPhone ?? ''),
                          ),
                        ),
                      if (_trackedParcel!.departureGarageName != null && _trackedParcel!.departureGarageName!.isNotEmpty)
                        ListTile(
                          leading: const Icon(Icons.departure_board, color: Colors.orange),
                          title: const Text('Départ'),
                          subtitle: Text(_trackedParcel!.departureGarageName!),
                        ),
                      if (_trackedParcel!.arrivalGarageName != null && _trackedParcel!.arrivalGarageName!.isNotEmpty)
                        ListTile(
                          leading: const Icon(Icons.location_on, color: Colors.orange),
                          title: const Text('Arrivée'),
                          subtitle: Text(_trackedParcel!.arrivalGarageName!),
                        ),
                      ListTile(
                        leading: const Icon(Icons.calendar_today, color: Colors.grey),
                        title: const Text('Créé le'),
                        subtitle: Text(_formatDate(_trackedParcel!.createdAt)),
                      ),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 16),
              // Actions
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _shareTrackingNumber,
                      icon: const Icon(Icons.share),
                      label: const Text('Partager'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF0B6E3A),
                        side: const BorderSide(color: Color(0xFF0B6E3A)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _downloadReceipt,
                      icon: const Icon(Icons.download),
                      label: const Text('Reçu'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF0B6E3A),
                        side: const BorderSide(color: Color(0xFF0B6E3A)),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}